# KMail flow — the email module, analysed

The KPost **KMail** module: email with read receipts and external interoperability. FR-M01..M09 and
BR-M01. This is the analysis before the build — the codes, the application flow, the send contract
(from the live client), the endpoint inventory, and the host question the build must settle.

Source of truth: the `kmail-api` contract (`contracts/kmail-api.contract.json`, 71 endpoints) + the
KMail-prefixed rows in the KPost contract, and the live web client (`components/Kmail/*`,
`Services/Kmail.js`). Codes: the workbook Types tab, exposed as `KMAIL_TYPE` / `KMAIL_RECEIVER_TYPE`
/ `KMAIL_PRIORITY` in `@api/schemas/kpost-types`.

## 1. The codes (owner-supplied; already in the workbook, verified to match)

All three match the workbook exactly — nothing to add, only to pin.

**`kmailType`** (0–13)

    0 New      1 Reply    2 Forward   3 Reminder   4 Draft    5 Edit    6 Note
    7 Delete   8 Comment  9 Clarify  10 forward-thread  11 share  12 mail-otp  13 bulkmail

**`kmailReceiverType`** — `1 TO`, `2 COPY`, `3 CONFIDENTIAL`. The confidential recipient (3) is hidden
from the other recipients — KMail's equivalent of Katchup's Confidential Copy (NFR-SEC02).

**`kmailPriority`** — `0 low`, `1 medium`, `2 high`.

## 2. Application flow (FR-M01..M09, BR-M01)

    COMPOSE (New, type 0) ──► postMail ──► READ RECEIPT (per-recipient open date/time, BR-M01)
      subject, body,          kmailTransactionList         then the post-send actions, by kmailType:
      priority,               [{receiver, receiverType}]     Reply(1) Forward(2) Reminder(3) Draft(4)
      recipients TO/CC/BCC                                   Edit(5) Note(6) Delete(7) Comment(8)
                                                             Clarify(9) forward-thread(10) share(11)
                                                             mail-otp(12) bulkmail(13)

- **Compose** carries a subject, body, `priority`, and a **`kmailTransactionList`** — one entry per
  recipient with its `receiverType` (TO / COPY / CONFIDENTIAL). The confidential recipient rides in a
  transaction with `receiverType: 3` and is not shown to the others (BR mirrors Katchup NFR-SEC02).
- **Read receipts** record each recipient's exact open date/time (BR-M01), identical to Katchup
  (BR-X01) — the cross-module accountability rule.
- **Post-send actions** are the `kmailType` values: reply, forward, reminder, edit, note, comment,
  clarify, forward-thread, share, and delete (a soft delete via `deleteBySender`/`deleteByReceiver`).
- **Drafts** are their own sub-flow (`kmailType: 4`, `/draft/*`): save, list, per-contact, delete.
- **Bulk mail** (`kmailType: 13`) — `postBulkMail`, its own dashboard.
- **External interoperability** (FR-M08/M09) — `loadOtherDomainMails`, `addOtherDomainContacts`,
  `miscellaneousContacts`, `downloadODAttachment`: open-with and non-KPost (Gmail/Outlook/Yahoo)
  recipients.
- **Mail OTP** (`kmailType: 12`) — an OTP-gated path; blocked on live like every OTP flow.

## 3. The send contract (from the live client)

`postMail` (`/v2/sentMail/postMail/`, and `/sentMail/postMailMultiPart/` with attachments). The mail
carries `kmailType`, subject, body and `priority`; recipients are a **`kmailTransactionList`** array,
each `{ receiver, receiverType, sender, groupFlag, groupReceiverList? }`. Exact field spelling is
read from `WriteMailBox.js` / `MailFooter.js` during the build (the workbook documents the row but
not the full body). Bulk uses `postBulkMail`; drafts use `/draft/draftMail/`.

## 4. Endpoint inventory — 71 (kmail-api) + a few KPost-side

| Group          | Count | What                                                                                            |
| -------------- | ----: | ----------------------------------------------------------------------------------------------- |
| `common`       |    29 | dashboard, subjects, status counts, delete, important, contacts, convert-to-PDF, saluations     |
| `kmailSetting` |    20 | signature, instant reply, vacation response, customized saluations, other-mail accounts         |
| `readMail`     |     8 | sent/inbox mail content, reference content, draft content, OD attachment download               |
| `draft`        |     6 | draft CRUD + per-contact                                                                        |
| `sentMail`     |     4 | postMail, postMailMultiPart, credentials, otherDomain                                           |
| `v2`           |     3 | `/v2/sentMail/postMail/`, `/v2/aws/generate-presigned-url`, `/v2/readMail/downloadODAttachment` |
| `translator`   |     1 | translation (shared with Katchup)                                                               |

Reads (dashboard, counts, lists, content-by-id) dominate; the writes are compose/draft/delete/star
and the settings updates.

## 5. The host — SETTLED: `kmail5.kpostindia.com/kmail5/v2`

KMail is its **own suite** (`kmail-api`) on its **own host with a `/kmail5/v2` prefix** — the owner
supplied the base `https://kmail5.kpostindia.com/kmail5/v2/`, and the probe confirms it (a first probe
that omitted `/v2` misled an earlier note toward devapi2):

    401  kmail5.kpostindia.com/kmail5/v2/common/getSaluations/        <- real route, auth required
    405  kmail5.kpostindia.com/kmail5/v2/sentMail/postMail/           <- real route (POST; GET → 405)
    404  kmail5.kpostindia.com/kmail5/v2/common/definitelyNotARoute/  <- unknown → 404 (distinguishes!)

Unlike devapi2 (which 403s everything unauthenticated), kmail5 distinguishes real routes (401/405)
from unknown ones (404), so this is definitive. `KMAIL_API_BASE_URL` is set to
`https://kmail5.kpostindia.com/kmail5/v2`; the base already carries the `/kmail5/v2`, so the three
contract paths that begin `/v2/…` are defined with the `/v2` stripped from `path` and kept in
`contractPath` (schema lookup). **Confirmed by the first live read run: 84 validators pass, 0
valid-token/401 failures, 0 status-code (404) failures — the token is accepted and every path
resolves.**

## 6. Build plan (staged — KMail is 4× any prior module)

1. **Wire the suite + reads.** Settle the host, register the read endpoints (dashboard, counts,
   lists, saluations, contacts, settings reads) with `kmail` response envelope + auth. Run on live.
2. **Write lifecycles** — compose → read-back → delete (types 0/1/2/…), drafts, star, settings
   updates, translation. Gated `KMAIL_LIFECYCLE=true`, `allowLiveWrite`, self-cleaning, QA accounts
   only. The confidential-recipient secrecy rule (receiverType 3) gets its own test, like Katchup's.
3. **Mail OTP (type 12)** stays blocked (OTP-gated, no live bypass).
4. **Screen** — `/kmail` (`tests/e2e/kmail.spec.ts` already asserts the shell; deepen to compose
   controls / mail list once the API is in).

Codes pinned in the module's coverage self-test; the flow's discrepancies recorded here as found.
