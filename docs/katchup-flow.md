# Katchup — message types, share types, and the application flow

The analysis the Katchup tests are built on. Source of truth for the **codes** is the workbook Types
tab (`contracts/kpost-types.json`, exposed by `src/api/schemas/kpost-types.ts`); source of truth for
the **flow and payloads** is the live web client (`KPOST_REACTJS_2023_V1`), read directly rather than
guessed. FRD ids are FR-K01..K25 and BR-K01..K03.

## 1. The three enumerations (verified)

All three are already in the generated types contract and match the owner's definitions **exactly**.
Named, typed accessors exist: `KATCHUP_STATUS`, `KATCHUP_MESSAGE_TYPE`, `KATCHUP_SHARE_TYPE` (e.g.
`KATCHUP_MESSAGE_TYPE.secretMessage === 18`).

### `status` — delivery state of a message row (`katchupStatus`)

| code | meaning  |
| ---- | -------- |
| 0    | Sent     |
| 1    | Unread   |
| 2    | Read     |
| 3    | Not sent |
| 4    | Group    |

The client sends `status: 0` on every new message (WriteMessage.js, KatchupMessage.js `temp`). 1/2
are read-receipt states the server assigns; 3 is a failure state; 4 marks a group row.

### `messageType` — what kind of message it is (`katchupMessageType`)

| code | meaning                 | code | meaning                          |
| ---- | ----------------------- | ---- | -------------------------------- |
| 0    | Normal Message          | 15   | Forward Message (Reveal)         |
| 1    | Reply Message           | 16   | Forward Message (Hidden)         |
| 2    | Share Message           | 17   | Schedule call                    |
| 3    | Reminder Message        | 18   | Secret Message                   |
| 4    | sms Message             | 19   | bulk message                     |
| 5    | Note Message            | 20   | forward multiple thread (Reveal) |
| 6    | Edit Message            | 21   | forward multiple thread (Hidden) |
| 7    | Recall Message          | 22   | Share digital card               |
| 8    | Comment Message         | 23   | share location                   |
| 9    | Clarify Message         | 24   | forward_selected_attachment      |
| 10   | Notification Mail /msgs | 25   | Broadcast (reply enabled)        |
| 11   | Group Notification      | 26   | Broadcast (no reply msg)         |
| 14   | Copies Message          |      |                                  |

(12 and 13 are absent from the workbook — codes are not contiguous.)

Confirmed against the send code: the client sends `0` (normal), `14` (copies/Cc), `18` (secret) and
`19` (bulk). Forward uses `15`/`16` (reveal/hidden); `sharedType` on a share carries the same code.

### `shareType` — the original kind carried by a Copies/Forward wrapper (`katchupShareType`)

| code | meaning  | code | meaning |
| ---- | -------- | ---- | ------- |
| 1    | Reply    | 7    | Recall  |
| 2    | Share    | 8    | Comment |
| 3    | Reminder | 9    | Clarify |
| 5    | Note     | 10   | Mail    |
| 6    | Edit     | 15   | Forward |

A `Copies Message` (messageType 14) or forward wraps an original; `sharedType`/`sharedMsgType` says
what the original was, so the UI can label it "Copies · Reply", "Forwarded By", etc.
(MessageType.js). In the send payload the client sets `sharedType = messageType`.

## 2. Three discrepancies found while verifying — for the owner

1. **`recallMessage` payload.** The workbook sample is `{"msgID":1249,"status":5}`. The **live client
   sends `{"msgID": …, "groupFlag": false}`** (KatchupMessage.js `handleRecall`) — no `status`, and
   `status: 5` is not even a valid `katchupStatus` (the enum stops at 4). The definition follows the
   live client; the workbook sample looks stale. _Confirm?_

2. **The display labels `messageType 2` as "Forward".** MessageType.js renders `{type: 2, prefix:
"Forward"}`, but the type contract says `2 = Share Message` and forward is `15/16`. This is a UI
   display quirk, not a contract change — the send codes are authoritative — but worth knowing when
   reading the screen. _No action needed unless the display is wrong._

3. **FR-K02/BR-K01 amended, 2026-09-25: Subject is no longer mandatory.** Previously read as "every
   message must carry a Subject" (rejected or defaulted if empty). Per the owner's updated
   requirement, a message with no Subject must now be **accepted as-is** — an empty `subject: ""` is
   valid input, not an error condition. `sendMessage` already does this (200, stores `subject: ""`
   verbatim), so no backend fix is needed; this was previously mis-flagged as a defect (#615, now
   closed as invalid — not a bug, the requirement changed). The client still defaults an empty
   composer Subject to "General" before sending (WriteMessage.js, KatchupMessage.js) — that remains a
   UI convenience, not something the API enforces or ever needs to.

## 3. The send contract, from the live client

`POST /v2/katchup/sendMessage/` (JSON). The multipart `sendKatchupMsgMultiPart` path is **commented
out** in the current build — `SendMessage(temp)` is what runs — so the JSON endpoint is primary. The
fields the client sends (KatchupMessage.js `temp`):

    receiver            contactID (1:1) or groupKpostID (group)
    messageType         0 normal, 14 copies, 15/16 forward, 18 secret, 19 bulk …
    subject             "General" when the user leaves it blank
    actualMessage       the body (Quill delta / HTML string)
    attachmentCaption   JSON string, or null
    messageTime         epoch ms       serverTime  epoch ms
    status              0 (Sent)
    sessionID           "Web-Reactjs"
    groupFlag           true for a group conversation
    forwardReceiverList / groupForwardList   forwards
    groupmemberList     recipients when posting to a group
    selectedMembers     "Y" / "N"  (whole group vs a subset)
    secretMessageExpireTime   epoch ms, secret messages only
    isVanished          secret / disappearing
    sharedType          = messageType, for shares/copies
    temporaryMsgID      = OldMsgID (the message being replied to / edited / reposted; 0 for new)
    uuid[]              attachment uuids (uploaded first)
    isHtml  isVoiceMessage
    referenceMessageIDList / referenceMessageList   threaded references

`Cc` (Copy) rides in `copies` on the composer object and becomes a **messageType 14** message; the
`Confidential Copy` recipient is the confidential variant, hidden from the others (NFR-SEC02).

## 4. The message lifecycle, mapped to endpoints

```
COMPOSE ─ send ─────────────► sendMessage/           (1:1, group, secret, bulk)
  subject + body + Cc/CC       sendBulkKatchupMsg     (broadcast to many)
  attachments                  sendMessageForForwardSelectedAttachment

READ ── list a conversation ─► katchupMessagesForSelectedContactID/
  unread badge                 getUnopenedMessagesCount/ · …AndKmailsTotalCount/
  read receipts                getReadStatusGroupMessage/   (per-recipient open time — FR-K07)

SENDER ACTIONS (Bell menu, FR-K08..K20)
  Edit                         sendMessage (messageType 6, temporaryMsgID = original)
  Recall                       recallMessage/            {msgID, groupFlag}
  Note / Reminder              sendMessage (5 / 3)
  Forward / with thread        forwardKatchupMessage(New) · forwardKatchupMultipleMsgs
  Delete                       deleteKatchUpMessage/
  Mark important               markOrUnmarkImportantMessage/

RECIPIENT ACTIONS (Reply menu, FR-K21..K25)
  Reply / Comment / Clarify    sendMessage (1 / 8 / 9)
  Report Message               reportAbuse · getAllReportMsg

SEARCH / REFERENCE            searchKatchUpMessage(Subject) · filterKatchUpMessage/
                              getReferenceMSGDetails/ · getMessagesByReferenceMessageList
SHARES                        getSharedMessageInfo/ · getSharedMessageDetails/{msgID} · getBulkMessageInfo/
ATTACHMENTS                   download/{uuid} · downloadThumbnail · downloadFromS3 · mediaStreaming · generateThumbnailUsingUUID
```

## 5. What can run on the live application, and what is blocked

Two PERSONAL accounts exist (`Qatesting@`, `Qatesting2@`). That gates the module hard, because most
of Katchup either writes to a real inbox or needs recipients we do not have.

| Runs on live now (PERSONAL ×2)                                                                                                                                                          | Why it is safe                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| reads with no id: `getUnopenedMessagesCount`, `…TotalCount`, `getKatchupMessagesSubject`, `frequentlyAccessContacts`, `getAllReportMsg`                                                 | read our own account's state                                |
| conversation reads between **our two** accounts: `katchupMessagesForSelectedContactID`, `messageCountBetweenSenderAndReceiver`, `searchKatchUpMessage(Subject)`, `filterKatchUpMessage` | receiver is `QA_VICTIM_KPOST_ID`, which we own              |
| the **1:1 lifecycle**: send → read → recall → delete, `Qatesting → Qatesting2`                                                                                                          | a message to our own second account; recall+delete clean up |

| Blocked until more PERSONAL accounts exist                                               | Reason                                                 |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| group send, `groupmemberList`, `getReadStatusGroupMessage`, group forward                | a group needs ≥3 members to prove anything (FR-K06)    |
| **Cc / Confidential Copy** (messageType 14, NFR-SEC02)                                   | needs a third recipient to prove the CC is hidden from |
| bulk / broadcast (`sendBulk*`, messageType 19/25/26)                                     | "to many" needs many                                   |
| `reportAbuse`, `sendMessageForForwardSelectedAttachment`, id-keyed share/reference reads | need a real msgID or a counterparty we do not have     |

Blocked ≠ untested: each definition stays registered with the reason, so `docs/LIVE-ENDPOINTS.md`
counts it and it runs the moment the accounts arrive.

## 6. Open questions for the owner

1. ~~**Empty subject** — reject, or default to "General"?~~ **Answered by the owner, 2026-09-25: FR-K02
   requirement changed — Subject is no longer required.** A message with an empty Subject must be
   accepted as-is (not rejected, not silently defaulted). `sendMessage` already does exactly that
   (200, `subject: ""` stored verbatim), so this is now the documented, correct behaviour — not a
   defect. #615 [KP-9DD851] closed as invalid (requirement changed after filing).
   `lifecycle.spec.ts`'s "an empty subject is accepted" test confirms this.
2. **`recallMessage` payload** — `{msgID, groupFlag}` (live client) vs `{msgID, status:5}` (workbook)?
   (§2.1)
3. **How many extra PERSONAL accounts** will you create, and their ids — needed for group (≥3), Cc and
   confidential-copy. Three more (five total) covers a group of four plus a confidential-copy
   bystander.
4. **Is sending a real 1:1 message between our own two accounts on live acceptable**, given recall and
   delete clean it up? If not, the whole send lifecycle waits for a staging host and only the
   no-write reads run.
