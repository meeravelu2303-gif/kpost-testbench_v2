# Coverage gaps — requirements vs the in-scope run-level suite

## Current status — re-measured 2026-10-15 (supersedes the 2026-10-13 analysis below)

Measured by the annotation-driven generator (`npm run lint:tags -- --report` → `reports/rtm.xlsx`), which
counts a requirement **Covered** only when a test that asserts its acceptance criterion is linked to it.

|                       | 2026-10-13 doc                | Re-measured 2026-10-15, before | 2026-10-15, after                            |
| --------------------- | ----------------------------- | ------------------------------ | -------------------------------------------- |
| Requirements in scope | 139                           | 139                            | **142** (3 bolded FRD rows had been dropped) |
| Verified Covered      | "91 = 65 %" (FRD's own claim) | 48 = 35 %                      | **92 = 65 %**                                |
| Partial / Not covered | 34 / 14                       | 39 / 52                        | 39 / 11                                      |
| In-scope tests        | 831                           | 915                            | 922                                          |

Per module (excl. out-of-scope): Content 100 %, Group 86 %, Signup/Login 77 %, Katchup 65 %, KMail 64 %,
Security 60 %, Kall 47 %, KDirectory 38 %, Journeys 0 % (Partial).

**How links work now.** `annotation: [{ type: 'requirement', description: 'FR-…' }]` = the test asserts the
criterion; `type: 'requirement-partial'` = it proves only an entry point, a status or one half (caps the
requirement at Partial). Ids are checked against the requirement rows — an unknown id appears on the
"Unknown links" sheet and as a lint:tags WARN.

**Closed this round (each verified 2/2 live in isolation):** the already-built P1 specs (journey, real-time
receive, KMail reply/forward, Kall IDOR, token security, content correctness) linked; KMail composer controls
(#990 fixed) + To suggestions; Tamil/Hindi/emoji/long body round-trip to the recipient; attachment byte
integrity (SHA-256, Katchup + KMail); group add/remove/exit arithmetic; Kall exact fields + invitees; KMail
priority (High + default Low); FR-KM-005 and BR-M01 hard-asserted (red on #1365 / #1359); edited-token expiry
refusal (RTM-SEC02).

**Still open, buildable:** RTM-SEC02 genuine expired-token refusal (runs once a QA token in the bench history is
past its exp); FR-KD-004 contact count; FR-SL-025 identified user on the password step; Katchup Copy/Save/Reminder/
Transfer completions (entry only); FR-KL-005/007 (WebRTC-limited / tab only); RTM-E2E01 first KMail in the journey.

**Blocked — documented, not chased:** connected Kall / WebRTC (RTM-KALL-A01..A04, FR-KL-009); password-reset
single use (RTM-SEC03 — spare account missing, #821-824, OTP bypass); KMail folders, server-side search,
restore (RTM-KMAIL-F03/F04/F05 — no endpoint); signup/OTP remainder (FR-SL-016..018, 031).

**Group exit rule — decided by Meera 2026-10-15:** a promoted admin has the creator's rights and no admin may exit; admins remove members, only members exit. Asserted on every run; violated → #1366 (API) / #1367 (UI). **FR-GC-006 decided (Meera 2026-10-15):** a group needs the creator and at least one member; the app enforces it, the API does not → #1369.

---

## 2026-10-13 analysis (superseded — kept for its gap descriptions)

Analysis companion to `reports/rtm.xlsx`. **Analysis only** — no tests were written, executed, or
committed to produce it. Generated 2026-10-13 against the **831 in-scope run-level tests** (Admin and
`@framework` excluded; the ~6,700 generated contract-matrix cases collapse to 82 deduped rows).

## Headline

| Metric                                           | Value                                |
| ------------------------------------------------ | ------------------------------------ |
| Documented + assigned requirements (rows in RTM) | 153 (139 in-scope + 14 out-of-scope) |
| **Covered**                                      | **91 / 139 = 65 %**                  |
| Partial                                          | 34                                   |
| Not covered                                      | 14                                   |
| Orphan tests (not traced to any requirement)     | 705 of 831 (183 of 215 files)        |

The low traceability number is the real story: it is driven by a **thin FRD**, not thin testing. Only
~110 FRs are documented, and the FRD's "Where" column names a handful of specs. The bench actually runs
far more — security/IDOR, accessibility, resilience, per-screen performance/layout, and the generated
contract matrix — most of which map to NFRs or quality attributes the FRD never enumerated. See
[Orphan analysis](#orphan-analysis).

## How to read this / ID assignment

- Requirement IDs `FR-*`, `BR-*`, `NFR-*` come from `docs/reference/requirements-frd.md` and
  `docs/reference/business-rules.md` (the project's hand-maintained FR→spec map).
- IDs prefixed **`RTM-`** were **assigned by this analysis** for the areas the FRD is silent on (your
  point 4). Assignments:
  - `RTM-KALL-A01..A06`, `RTM-KALL-SEC01` — connected-call behaviours + Kall IDOR
  - `RTM-KMAIL-F01..F08` — reply/forward, attachments, folders, search, delete/restore, CC/BCC, delivery, drafts
  - `RTM-KU-M01..M06` — Katchup multi-user (real-time, receipts, unread, group delivery, offline, translate)
  - `RTM-SEC01..SEC04` — logout, session expiry, reset reuse, KMail IDOR
  - `RTM-E2E01` — full signup→first-use journey
  - `RTM-CON01..CON04` — Tamil/Hindi, emoji, long content, attachment integrity
  - `RTM-PERF01` — single-user page-load/layout budgets
- **Priority** (no priorities in the source docs, so proposed here by business criticality): **P1** =
  auth/security + core send/receive/call/mail; **P2** = secondary feature behaviour; **P3** = cosmetic.
- Per-gap fields: **layer**, **users** (single/multi), **writes data? + cleanup**, **effort**
  (S ≈ ½ day, M ≈ 1–2 days, L ≈ 3 days+ or blocked), **run level** it should join.

---

## P1 gaps — Not covered (6) — fix first

### RTM-E2E01 — Full journey: signup → first login → profile → first message/mail/call

- **Layer** E2E · **Users** multi · **Writes** yes (account + message/mail) · **Cleanup** recall/delete the test message, leave the seeded account (signup can't be automated) · **Effort** L · **Run level** sanity (one golden-path journey)
- **Why open** Signup is OTP-gated and out of scope, so the journey can't start from a real signup. The pieces (login, profile read, first Katchup send, first KMail send) all exist separately but are never stitched.
- **Proposed test** `tests/e2e/journey-first-use.spec.ts` — start from a pre-seeded fresh QATEST account, assert login → profile populated → send first Katchup to QATEST2 → send first KMail → each lands. Treat signup as a documented pre-condition, not a step.

### RTM-KU-M01 — Katchup real-time receive without refresh

- **Layer** E2E · **Users** multi (two sessions) · **Writes** yes (one message) · **Cleanup** delete the sent message in `finally` · **Effort** M · **Run level** regression
- **Why open** Receipt is only ever verified by an API read-back/reload; nothing asserts the recipient's open thread updates live (socket/push).
- **Proposed test** `tests/e2e/katchup-realtime-receive.spec.ts` — session A sends while session B has the thread open; assert B's DOM shows the new bubble **without** a reload within a timeout.

### RTM-KMAIL-F01 — KMail Reply / Reply-all / Forward

- **Layer** E2E (UI) + API read-back · **Users** multi · **Writes** yes (mails) · **Cleanup** delete created mails via the mail-delete API · **Effort** M · **Run level** regression
- **Why open** No KMail reply/forward test exists (the keyword hits were Katchup reply and Settings instant-reply). Blocked in the UI while `/writemail` crashes (#990) — drive via API first.
- **Proposed test** `tests/api/kmail/reply-forward-workflow.spec.ts` + a UI spec once #990 clears.

### RTM-KALL-SEC01 — IDOR on Kall resources

- **Layer** API · **Users** multi (owner vs stranger) · **Writes** no (read probes) · **Cleanup** none · **Effort** M · **Run level** regression (`@security`)
- **Why open** Katchup and KMail have object-authorization/IDOR specs; Kall has none. A stranger reading another user's `kallInfo`/call record is unprobed.
- **Proposed test** `tests/api/kpost/kall/object-authorization.spec.ts` — A creates a call; B (unrelated) attempts to read/modify it by id; assert refused. Mirror `katchup-object-authorization.spec.ts`.

### RTM-SEC03 — Password-reset link cannot be reused

- **Layer** API · **Users** single · **Writes** yes (password change) · **Cleanup** reset the spare account's password back · **Effort** M (**blocked**) · **Run level** regression (`@security`)
- **Why open** Blocked: the spare forgot-password account is broken (#821–824), so a reset link can't be minted/consumed to prove single-use. Unblock the account first.

### RTM-KALL-A01 — Connected A→B call (ring → accept → hang-up both sides)

- **Layer** E2E · **Users** multi · **Writes** yes (call record) · **Cleanup** end the call · **Effort** L (**structurally blocked**) · **Run level** sanity (if ever unblocked)
- **Why open** No WebRTC peer connects on this bench (FR-KL-009): `kallStartTime/EndTime/Duration` stay null through initiate→end. Needs a real two-party connected call — out of reach without a media harness. Documented limitation, not a product defect.

---

## P1 gaps — Partial (26) — strengthen the assertion

Most of these are already written but either **record a finding instead of a hard assertion**, are
**UI-blocked by `/writemail` crash #990**, or are **structurally limited**. Grouped:

**Group member/admin arithmetic (findings, not hard asserts)** — `FR-GC-006`, `FR-GM-010/011/012/014`.
Layer API · multi-user · **writes** yes (group lifecycle) · cleanup blocked by `removeGroupMember` 500 (#… group teardown) so groups pile up — gate under `QA_GROUP_CLEANUP` · effort S each · run level regression. _Strengthen:_ assert the exact count delta and membership list, not just a 2xx/finding.

**Kall scheduling/participants/log** — `FR-KL-001` (only `scheduledStartTime` enforced; assert `subject`/`endTime` too), `FR-KL-002` (assert invitee present in read-back), `FR-KL-009` (timestamps null — structurally blocked). Layer API · single/multi · writes yes (scheduled call) · cleanup delete the scheduled call · effort S–M · regression.

**KMail compose depth (UI-blocked by #990)** — `FR-KM-014` attach, `FR-KM-016` formatting, `FR-KM-017` AI assist, `FR-KM-022` external recipient, `RTM-KMAIL-F02` attachment download/size-limit, `RTM-KMAIL-F06` CC/BCC, `RTM-KMAIL-F07` plain-mail delivery. Layer UI(+API) · single/multi · writes yes (mail) · cleanup delete mail · effort M · regression. _Unblock #990 first_, then un-skip the written specs and add download/size-limit + a clean inbox-arrival assertion.

**KMail semantics** — `FR-KM-005` single-recipient (finding→assert rejection), `FR-KM-010/011` priority flag (assert flag persisted), `BR-M01/SRS-M02` read receipt (to-do: assert open timestamp appears only after open). Layer API · single/multi · writes yes · cleanup delete mail · effort S–M · regression.

**Katchup disappearing/forward** — `BR-KU-DISAPPEAR-READ/SCHED/IMMUTABLE` (confirmed broken, filed #976 — keep as regression guards asserting the _correct_ behaviour once fixed), `BR-KU-FORWARD-HIDE` (classic theme leaks sender #972). Layer API · multi · writes yes · cleanup delete message · effort S · regression (`@bug-976`, `@bug-972`).

**Session expiry** — `RTM-SEC02`: JWT bounded-expiry + expired-token-rejected covered; **server-side idle/session timeout not driven**. Layer API · single · writes no · effort M · regression.

**Signup remainder** — `FR-SL-016..018`, `FR-SL-031`: standing owner exclusion (OTP/signup by hand) — not a bench to-do, listed for completeness.

**Admin** — `BR-ADM-500-VALIDATION` is Admin-scope (out of the run-level set); listed because the FRD references it.

---

## P2 / P3 gaps (condensed)

- **RTM-KMAIL-F03 Folders (Sent/Trash/Spam)** — Not covered · E2E · single · reads · S · regression · `tests/e2e/kmail-folders.spec.ts`.
- **RTM-KMAIL-F04 Mail search** — Not covered · E2E · single · reads · S · regression.
- **RTM-KMAIL-F05 Delete+restore** — Partial (delete only) · API · single · writes+cleanup · S · regression — add restore-from-trash.
- **RTM-KU-M05 Offline→next-login delivery** — Not covered · E2E · multi · writes+cleanup · M · regression.
- **RTM-KU-M06 Katchup message translation** — Partial · E2E · single · reads · S · regression.
- **RTM-KALL-A02 reject / A03 missed / A04 mute-camera / A05 log / A06 Kool Kall join** — Not covered/Partial · E2E/API · multi · writes(call)+cleanup · M · regression (A01-blocked ones inherit the WebRTC limitation).
- **RTM-CON01 Tamil/Hindi content** — Partial · E2E · multi · writes+cleanup · M · regression · assert a Tamil/Hindi body round-trips unchanged through send→receive.
- **RTM-CON03 Long content (UI)** — Partial · E2E · single · writes+cleanup · S · regression.
- **RTM-CON04 Attachment byte integrity** — Not covered · E2E · single · writes+cleanup · M · regression · assert downloaded bytes == uploaded.
- **RTM-CON02 Emoji integrity** (P3) — Not covered · E2E · single · writes+cleanup · S · regression.

---

## Explicit assessment of the areas you named

| Area                                                             | Verdict                                    | Evidence / ID                                |
| ---------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------- |
| **Kall** A→B ring/accept/hang-up, reject, missed, end-both-sides | **Not covered** (WebRTC bench limit)       | `RTM-KALL-A01/A02/A03`, FR-KL-009            |
| Kall call history                                                | **Partial** (reads yes, timestamps null)   | `RTM-KALL-A05`, FR-KL-008/009                |
| Kall mute/camera toggle                                          | **Not covered**                            | `RTM-KALL-A04`                               |
| Kool Kall join                                                   | **Partial** (tab + schedule only)          | `RTM-KALL-A06`                               |
| **KMail** reply/reply-all/forward                                | **Not covered**                            | `RTM-KMAIL-F01`                              |
| KMail attachments (upload/download/size)                         | **Partial** (upload written, #990-blocked) | `RTM-KMAIL-F02`, FR-KM-014                   |
| KMail drafts                                                     | **Covered (API)**                          | `RTM-KMAIL-F08`                              |
| KMail folders (sent/trash/spam)                                  | **Not covered**                            | `RTM-KMAIL-F03`                              |
| KMail search                                                     | **Not covered**                            | `RTM-KMAIL-F04`                              |
| KMail delete/restore                                             | **Partial** (delete only)                  | `RTM-KMAIL-F05`                              |
| KMail CC/BCC                                                     | **Partial** (Cc + confidential bcc)        | `RTM-KMAIL-F06`, FR-KM-006                   |
| KMail delivery to recipient                                      | **Partial**                                | `RTM-KMAIL-F07`                              |
| **Katchup** real-time receive (no refresh)                       | **Not covered**                            | `RTM-KU-M01`                                 |
| Katchup read receipts                                            | **Covered**                                | `RTM-KU-M02`, BR-KU-RECEIPTS                 |
| Katchup unread counts                                            | **Covered (API)**                          | `RTM-KU-M03`                                 |
| Katchup group delivery                                           | **Covered**                                | `RTM-KU-M04`                                 |
| Katchup offline→next-login                                       | **Not covered**                            | `RTM-KU-M05`                                 |
| Katchup message translation                                      | **Partial**                                | `RTM-KU-M06`                                 |
| **Security** logout invalidates token                            | **Covered**                                | `RTM-SEC01`, BR-SL-LOGOUT                    |
| Security session expiry                                          | **Partial** (token expiry only)            | `RTM-SEC02`                                  |
| Security password-reset reuse                                    | **Not covered** (blocked #821–824)         | `RTM-SEC03`                                  |
| Security IDOR — KMail                                            | **Covered**                                | `RTM-SEC04`                                  |
| Security IDOR — Kall                                             | **Not covered**                            | `RTM-KALL-SEC01`                             |
| **Full journey** signup→first use                                | **Not covered**                            | `RTM-E2E01`                                  |
| **Content** Tamil/Hindi                                          | **Partial** (locale only)                  | `RTM-CON01`                                  |
| Content emoji                                                    | **Not covered**                            | `RTM-CON02`                                  |
| Content long content                                             | **Partial** (API boundary only)            | `RTM-CON03`                                  |
| Content attachment integrity                                     | **Not covered**                            | `RTM-CON04`                                  |
| **Perf** single-user page-load budgets                           | **Covered**                                | `RTM-PERF01` (~46 `*-screens-dynamic` tests) |

---

## Orphan analysis

705 of 831 in-scope tests (183 of 215 files) are not traced to any requirement. By category:

| Category                       | Files | Note                                                                                |
| ------------------------------ | ----- | ----------------------------------------------------------------------------------- |
| UI flows (other)               | 86    | Feature specs the FRD's "Where" column simply doesn't name — real traceability debt |
| API workflow / read / write    | 41    | Same — contract and workflow specs not FR-linked                                    |
| Security probes                | 26    | Map to NFR-SEC / IDOR, not functional FRs                                           |
| Accessibility (axe / keyboard) | 12    | Quality attribute, no FRD requirement                                               |
| Resilience / negative          | 11    | Quality attribute                                                                   |
| Screen-sweep / visual / crawl  | 5     | Layout/visual budgets                                                               |
| Generated API matrix (deduped) | 2     | `endpoint-cases` / `contract-suite` schema+authz cases                              |

~56 files (security/a11y/resilience/visual/generated) are **legitimately requirement-agnostic**. The
~127 UI/API flow files are the genuine traceability gap — they exercise product behaviour but aren't
linked to an FR. The fix is process, not more tests (next section). The full list is the **Orphan
tests** sheet of `reports/rtm.xlsx`.

---

## Proposal — keep the RTM current (not applied)

Link tests to requirements with a **Playwright annotation**, not a tag (tags are for run-level selection;
requirement IDs would pollute the tag taxonomy and blow the `lint:tags` budgets):

```ts
test(
  'group member add increments count',
  {
    annotation: [{ type: 'requirement', description: 'FR-GM-010' }],
  },
  async () => {
    /* ... */
  },
);
```

Then extend `scripts/lint-tags.mjs --report` to also:

1. read each test's `annotations` (already present in the `--list --reporter=json` output — the inventory
   confirmed the field exists, currently empty);
2. join `type: "requirement"` descriptions against the FR/BR IDs parsed from `requirements-frd.md` +
   `business-rules.md`;
3. regenerate `reports/rtm.xlsx` (Requirements, Summary, Orphans) the same way this analysis did.

Benefits: traceability lives **next to the test** and never drifts; a new test with no `requirement`
annotation shows up as an orphan automatically; a requirement with no linked test shows up as a gap. Add
a soft CI check (warn, don't fail) that every `@regression` feature spec carries at least one
`requirement` annotation, so the orphan set only shrinks over time. No change to the run-level tags or
budgets.
