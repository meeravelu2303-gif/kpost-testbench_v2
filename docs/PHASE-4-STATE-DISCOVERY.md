# Phase 4A — Discovery: application state, transitions, and how they could be observed

**Status: DISCOVERY ONLY. Nothing in this document is implemented.** No source file, test, validator,
reporter, endpoint definition or Bugzilla integration was created or modified to produce it, and no
state registry, schema or guard was introduced — the discovery did not require one. Every claim about
current behaviour is quoted from the repository at commit `1c0d86b`, with file and line references.

The objective is to answer one question without inventing anything:

> Which application resources have meaningful states, what states are documented, what transitions
> are documented, who performs them, and how could those states eventually be observed?

---

## 1. Executive summary

### 1.1 The decisive finding

The bench's problem is **not** that KPOST application state is unobservable. It is that the state is
already returned, already reachable, and **read by nothing**.

Thirteen registered endpoints return a Katchup message row carrying per-message state
(`status`, `readTime`, `deletedBy`, `importantBy`, `markedBy`, `isVanished`), and five of them run on
live today. The documented sample for the 1:1 conversation read shows the correlation plainly
([contracts/kpost-api.contract.json](../contracts/kpost-api.contract.json), the
`katchupMessagesForSelectedContactID` response example):

```
  msgID 8247   status 0 ("Sent")   readTime null                              readTimeAsLong 0
  msgID 8101   status 2 ("Read")   readTime "2023-10-09T16:53:23.000+00:00"   readTimeAsLong 1696870403000
```

And yet:

```
$ grep -rn "readStatus|readTime|deletedBy|importantBy|markedBy|deleteStatus|recallStatus|msgsCount" \
        src/ tests/ --include=*.ts
(no matches)
```

**Not one of those field names appears anywhere in `src/` or `tests/`.** The same is true of KMail's
much richer per-recipient record (`deliveryStatus`, `readStatus`, `replyStatus`, `deleteBySender`,
`deleteByReceiver`, `letterReadTime`) and of Kall's `receiverKallStatus`, `joinStatus`,
`deletedBySender`.

This reframes the Phase 2A conclusion. Phase 2A found that the read receipt is "verified nowhere" and
attributed it to a missing endpoint. That is half right, and the precise version matters for what
Phase 4B should build (§8.2).

### 1.2 What the evidence supports

| Question                                                 | Answer                                                                                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Do KPOST resources have documented states?               | **Yes** — a closed, owner-supplied enum vocabulary exists in `contracts/kpost-types.json`, generated from the authoritative workbook |
| Are those states returned by the API?                    | **Yes** — documented response samples carry them on message, call, group-membership and mail-transaction rows                        |
| Are they observable on live?                             | **Largely yes** — the reads that carry them are `productionSafe` and already run                                                     |
| Does the bench observe any of them?                      | **Almost never** — see §6.4; there is essentially one genuine state read-back in the entire repository                               |
| Can a minimal State Model be defined from this evidence? | **Yes, for three resources** (§11), and explicitly **not** for four others                                                           |

### 1.3 The one genuine state assertion in the repository

For calibration, the entire bench contains exactly two assertions that read an application state value
back and compare it:

1. `expect.soft(row.senderKallStatus, 'BR-C01: reschedule sets the status tag to ReScheduled (7)').toBe(7)`
   — [tests/api/kpost/kall/feature.spec.ts:229](../tests/api/kpost/kall/feature.spec.ts#L229), guarded
   by `if (row?.senderKallStatus !== undefined)` so it passes vacuously when the field is absent.
2. The confidential-recipient visibility read-back at
   [tests/api/kmail/feature.spec.ts:261-268](../tests/api/kmail/feature.spec.ts#L261) — which proves a
   _visibility_ rule, not a lifecycle state.

Everything else in Katchup, Kall, Group, KMail, KDiary and attachments is asserted as an HTTP status
code, and always with `expect.soft`.

---

## 2. The five meanings of "state" in this repository

The word already denotes five different things here. Conflating any two of them would be the single
most damaging thing Phase 4B could do, so they are separated first. **Only category A is the subject
of the future State Model.**

| #     | Concept                                                                           | Vocabulary                                                                       | Owner                   | Where                                                                          |
| ----- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------ |
| **A** | **Application state** — the state of a real KPOST resource                        | `katchupStatus` 0–4, `kallStatus` 0–11, `readStatus` Y/N, `hasAdminAccess` Y/N … | **nothing today**       | the app; `contracts/kpost-types.json`                                          |
| **B** | Flow execution status — did a step run?                                           | `NOT_EXECUTED · BLOCKED · SKIPPED · PASSED · FAILED`                             | `FlowRun`               | [src/flows/flow.ts:86](../src/flows/flow.ts#L86)                               |
| **C** | Flow artifact availability — is an upstream value present?                        | present / absent (typed `FlowArtifact<T>`)                                       | `FlowRun.has/require`   | [src/flows/flow-run.ts](../src/flows/flow-run.ts)                              |
| **D** | Test-bench resource lifecycle — what did the bench create, and was it cleaned up? | `REGISTERED · CLEANUP_PENDING · CLEANED · CLEANUP_FAILED`                        | `ResourceLedger`        | [src/test-data/resource-record.ts:26](../src/test-data/resource-record.ts#L26) |
| **E** | Failure classification / confidence                                               | `FailureClass` (7), `REASON_CODES` (18), `ConfidenceDecision` (3)                | `src/failure-analysis/` | Phase 3.3 / 3.4                                                                |

### 2.1 The collisions that already exist, and must not be "tidied"

- **`BLOCKED`** appears in category B only. Phase 2C already documented that it is _not_ the Phase 3.3
  `PRECONDITION_FAILED` reason code ([src/flows/flow.ts:56-75](../src/flows/flow.ts#L56)). A future
  application state must not reuse the word.
- **`CLEANED` vs "deleted"** is the sharpest trap. Category D's `CLEANED` means _the bench removed the
  record it created_. Category A's deletion state (`deletedBy`, `deleteStatus`, `deleteBySender`) means
  _the application marked the resource deleted for a particular party_. These are different facts about
  different subjects: a message can be `CLEANED` in the ledger while the application still shows it to
  the recipient, and vice versa. The ledger must not be read as evidence of application deletion.
- **`status`** is used by the HTTP layer (`response.status`), by the KPost envelope
  (`status: "SUCCESS"`), and by the application resource (`status: 2` on a message row). Three
  unrelated meanings, all spelled `status`. Any state model must qualify the term at every use.

---

## 3. Candidate resources with meaningful state

Recorded only where repository evidence supports them. "Evidence" means an enum in the generated types
contract, a field in a documented response sample, or explicit documentation prose.

| Resource                                   | Module                | Evidence source                                | Evidence location                                                                                                                           | State explicitly documented?             | Confidence                      | Unresolved ambiguity                                                                                                         |
| ------------------------------------------ | --------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Katchup message**                        | katchup               | `katchupStatus` enum + response samples        | `contracts/kpost-types.json:6-12`; `docs/katchup-flow.md:14-26`                                                                             | **Yes** (5 codes)                        | HIGH                            | codes `1 Unread` / `3 Not sent` appear in no captured sample; `4 Group` is not a lifecycle state (§7.1)                      |
| **Katchup per-recipient receipt**          | katchup               | `getReadStatusGroupMessage` response sample    | `contracts/kpost-api.contract.json` (`readStatus`, `readTime`, `replyStatus`, `recallStatus`, `importantStatus`, `deleteStatus`)            | **Yes** (6 Y/N flags)                    | HIGH                            | group messages only; no 1:1 equivalent endpoint                                                                              |
| **Kall (call)**                            | kall                  | `kallStatus` enum + response samples           | `contracts/kpost-types.json:40-53`; `docs/kall-flow.md:16-19`                                                                               | **Yes** (12 codes)                       | HIGH                            | returned as a _string label_ in samples but a _numeric code_ in the enum (§7.2); codes 9/10/11 have no documented transition |
| **Kall participant**                       | kall                  | `kallScheduleDetails[]` / `kallDetails[]` rows | `contracts/kpost-api.contract.json` (`kallAcceptStatus`, `joinedStatus`, `receiverKallStatus`, `joinStatus`, `deleteStatus`)                | Partly — fields documented, meanings not | MEDIUM                          | two different shapes (`kallScheduleDetails` vs `kallDetails`) for what appears to be the same idea                           |
| **Group membership**                       | group                 | `hasAdminAccess` + member row                  | `src/api/definitions/kpost/group/group.api.ts:24`; `contracts` member sample (`hasAdminAccess`, `privacyStatus`, `removedFlag`)             | Partly — `Y`/`N` only, no enum           | MEDIUM                          | no enum group exists for `group` in the types contract at all                                                                |
| **Group**                                  | group                 | create response sample                         | `activeStatus: "Y"`, `isPrivateGroup: "Y"`                                                                                                  | Weak — flags, not a documented lifecycle | LOW                             | never read back; no group _read_ endpoint exists (§9.2)                                                                      |
| **KMail mail transaction** (per recipient) | kmail                 | `kmailTransactionList[]` in response samples   | `contracts/kmail-api.contract.json` (`deliveryStatus`, `readStatus`, `replyStatus`, `deleteBySender`, `deleteByReceiver`, `letterReadTime`) | **Yes** (5 Y/N flags + a timestamp)      | HIGH                            | `kmailType` is numeric on send but a free string (`'Sent'`/`'Received'`) on reads                                            |
| **KMail draft**                            | kmail                 | `draftMailID` issued by save                   | `src/api/definitions/kmail/draft.api.ts:50`                                                                                                 | No — an id, not a state                  | LOW                             | three names for one id (`draftMailID` / `draftKmailID` / `senderUniqueMailID`)                                               |
| **KDiary event**                           | kdiary                | `kdiaryRemarks` enum                           | `contracts/kpost-types.json:84-92`                                                                                                          | **Yes** (7 codes)                        | HIGH (documented) / NONE (used) | the enum is imported by **no** file; only the literal `1` is ever sent                                                       |
| **Attachment**                             | aws / katchup / kmail | `checkAttachmentS3` summary; `attachmentFlag`  | `src/api/definitions/kpost/aws/aws.api.ts:50`                                                                                               | No — existence only, no state vocabulary | LOW                             | no before/after existence check exists anywhere                                                                              |

**Deliberately excluded for want of evidence:** _contact_ (block/unblock exists as an action but no
state field is documented), _profile_, _company_, _session_. Adding them would be invention.

---

## 4. Deliverable A — Resource state inventory

Status key: **DOCUMENTED** (in an authoritative source) · **OBSERVED** (seen in a live run recorded in
the repository) · **DERIVED** (inferred by the repository from another field) · **UNKNOWN** ·
**CONFLICTED**.

### 4.1 Katchup message — `katchupStatus`

| Resource | Module  | State                                | Meaning                                                               | Evidence                                                       | Status                                         |
| -------- | ------- | ------------------------------------ | --------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------- |
| message  | katchup | `0` Sent                             | client sets it on every new send                                      | `contracts/kpost-types.json:7`; `send.api.ts:34`; sample rows  | DOCUMENTED + OBSERVED (sent)                   |
| message  | katchup | `1` Unread                           | server-assigned read-receipt state                                    | `contracts/kpost-types.json:8`; `docs/katchup-flow.md:24-26`   | DOCUMENTED (appears in **no** captured sample) |
| message  | katchup | `2` Read                             | server-assigned; correlates with a populated `readTime`               | types contract + conversation sample                           | DOCUMENTED                                     |
| message  | katchup | `3` Not sent                         | failure state                                                         | `contracts/kpost-types.json:10`                                | DOCUMENTED (never seen)                        |
| message  | katchup | `4` Group                            | marks a group row — **not a lifecycle state**                         | `contracts/kpost-types.json:11`; sent at `feature.spec.ts:291` | **CONFLICTED** (§7.1)                          |
| message  | katchup | `isVanished` true/false              | disappear-after-reading                                               | `send.api.ts:42`; sample                                       | DOCUMENTED                                     |
| message  | katchup | `secretMessageExpireTime` epoch/null | disappear-as-per-schedule                                             | `send.api.ts:41`; sample                                       | DOCUMENTED                                     |
| message  | katchup | `deletedBy`                          | who deleted it                                                        | conversation sample                                            | DOCUMENTED (read by nothing)                   |
| message  | katchup | `importantBy` / `markedBy`           | marked important / saved                                              | conversation sample                                            | DOCUMENTED (read by nothing)                   |
| message  | katchup | "edited"                             | **no field** — inferred from `messageType: 6`                         | `feature.spec.ts:177`; UI string `Edited`                      | **DERIVED**                                    |
| message  | katchup | "recalled"                           | **no field** — inferred from `messageType: 7` / absence from the view | `docs/katchup-flow.md:67-69`                                   | **DERIVED**                                    |

### 4.2 Katchup per-recipient receipt (group only)

| State                                                            | Values           | Evidence                           | Status     |
| ---------------------------------------------------------------- | ---------------- | ---------------------------------- | ---------- |
| `readStatus`                                                     | `Y` / `N`        | `getReadStatusGroupMessage` sample | DOCUMENTED |
| `readTime`                                                       | timestamp / null | same                               | DOCUMENTED |
| `replyStatus`, `recallStatus`, `importantStatus`, `deleteStatus` | `Y` / `N`        | same                               | DOCUMENTED |

### 4.3 Kall

| State                                                 | Meaning                            | Evidence                         | Status                                                    |
| ----------------------------------------------------- | ---------------------------------- | -------------------------------- | --------------------------------------------------------- |
| `0` new → `1` connected → `8` closed                  | the call-progress spine            | `docs/kall-flow.md:32-37`        | DOCUMENTED                                                |
| `2` cancelled, `3` noresponse, `4` declined, `5` busy | terminal outcomes of a placed call | `docs/kall-flow.md:34`           | DOCUMENTED                                                |
| `6` Scheduled → `7` ReScheduled                       | the BR-C01 pair                    | `docs/kall-flow.md:43-44`        | DOCUMENTED + **CONFLICTED** on observation (§7.3)         |
| `9` removed, `10` KoolKall Accepted, `11` Not Joined  | —                                  | enum only                        | **UNKNOWN** — no flow, no actor, no transition documented |
| `deletedBySender`                                     | the app's own delete state         | `CLAUDE.md:3071-3072` (live run) | **OBSERVED**, never asserted                              |
| participant `kallAcceptStatus`, `joinedStatus`        | `Y`/`N` per invitee                | `todayKoolKall` sample           | DOCUMENTED                                                |

`1 connected` is **unreachable by this bench** — there is no second WebRTC peer
([docs/kall-flow.md:102-103](kall-flow.md)).

### 4.4 Group

| State                                  | Values       | Evidence                         | Status                       |
| -------------------------------------- | ------------ | -------------------------------- | ---------------------------- |
| membership `hasAdminAccess`            | `Y` / `N`    | `group.api.ts:24`; member sample | DOCUMENTED                   |
| membership `removedFlag`               | true / false | `addUserToGroup` sample          | DOCUMENTED (read by nothing) |
| membership `privacyStatus`             | `Y` / `N`    | `group.api.ts:28`                | UNKNOWN meaning              |
| group `activeStatus`, `isPrivateGroup` | `Y` / `N`    | create sample                    | UNKNOWN meaning              |

There is **no `group` section in `contracts/kpost-types.json`** — group state has no enum vocabulary at
all, only ad-hoc `Y`/`N` strings.

### 4.5 KMail

| State                                             | Values                                           | Evidence                                              | Status                                  |
| ------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------- | --------------------------------------- |
| transaction `deliveryStatus`                      | `Y` / `N`                                        | `sentAndInboxMailContent` sample                      | DOCUMENTED                              |
| transaction `readStatus` + `letterReadTime`       | `Y`/`N` + epoch                                  | same; `sentMailNotOpened` sample                      | DOCUMENTED                              |
| transaction `replyStatus` + `letterReplyTime`     | `Y`/`N` + epoch                                  | same                                                  | DOCUMENTED                              |
| transaction `deleteBySender` / `deleteByReceiver` | `Y` / `N`                                        | same; `docs/kmail-flow.md:41`                         | DOCUMENTED                              |
| `receiverType`                                    | `1` TO / `2` COPY / `3` CONFIDENTIAL             | `contracts/kpost-types.json`; `docs/kmail-flow.md:21` | DOCUMENTED                              |
| `kmailType`                                       | 0–13 numeric **or** `'Sent'`/`'Received'` string | `send.api.ts:31` vs `read.api.ts:414`                 | **CONFLICTED** (§7.4)                   |
| `priority`                                        | 0 low / 1 medium / 2 high                        | types contract                                        | DOCUMENTED                              |
| `kmailStatusFlag`                                 | literal `2` sent once                            | `read.api.ts:201`                                     | **UNKNOWN** — no enum, no documentation |

### 4.6 KDiary

`kdiaryRemarks` — `0` None, `1` Completed, `2` Pending, `3` Not Done, `4` ReSchedule, `5` OnHold,
`6` Delete ([contracts/kpost-types.json:84-92](../contracts/kpost-types.json)). **DOCUMENTED**, and
entirely unused: `KDIARY_REMARKS` is exported at
[src/api/schemas/kpost-types.ts:78](../src/api/schemas/kpost-types.ts#L78) and imported by no file;
only the magic literal `1` is ever transmitted
([write.api.ts:115](../src/api/definitions/kpost/kdiary/write.api.ts#L115)).

---

## 5. Deliverable B — Transition inventory

Only transitions with repository evidence. Actor roles reference the Phase 3 vocabulary
([src/actors/role.ts](../src/actors/role.ts)) and mean **"the documented actor for this action"** —
never "this actor is authorized under all conditions" (§6 of the brief).

### 5.1 Katchup message

| From                 | Action                           | To                            | Actor                   | Requirement     | Evidence                     | Observable?                                                   |
| -------------------- | -------------------------------- | ----------------------------- | ----------------------- | --------------- | ---------------------------- | ------------------------------------------------------------- |
| —                    | `sendMessage`                    | `0` Sent                      | `sender`                | FR-KU-003       | `send.api.ts:34`             | **Yes** — send response carries the row                       |
| `0` Sent             | recipient opens the conversation | `2` Read + `readTime` set     | `recipient`             | FR-K07          | `docs/katchup-flow.md:24-26` | **Read state yes; the act of reading has no endpoint** (§8.2) |
| `0`/`2`              | `recallMessage`                  | removed from recipient view   | `sender`                | FR-K10 / BR-K03 | `manage.api.ts:19-30`        | Only by absence of body text                                  |
| any                  | `editMessage` (`messageType 6`)  | body changed, `Edited` marker | `sender`                | FR-KU / BR-K03  | `feature.spec.ts:167-179`    | Body text only; no state field                                |
| any                  | `deleteKatchUpMessage`           | `deletedBy` set               | `sender` or `recipient` | FR-K20          | `manage.api.ts:45`           | `deletedBy` returned, read by nothing                         |
| any                  | `markOrUnmarkImportantMessage`   | `importantBy` set             | `sender`/`recipient`    | FR-K18          | endpoint registered          | `importantBy` returned, read by nothing                       |
| `0` Sent (vanishing) | recipient reads                  | deleted                       | `recipient`             | FR-KU-017..024  | `CLAUDE.md:1458-1459`        | **No** — disappearance never verified                         |

**Documented but unimplemented precondition:** BR-KU-RECALL-UNREAD — _recall is allowed ONLY before the
recipient has read it_ ([docs/business-rules.md:40](business-rules.md)). This is the **only** place in
the repository where a read state gates a permitted transition, and it is marked ⬜ to-do. It is the
strongest single argument for a State Model: the rule is unexpressible without one.

### 5.2 Kall

| From          | Action                                    | To                                                                       | Actor                               | Requirement        | Evidence                  |
| ------------- | ----------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------- | ------------------ | ------------------------- |
| —             | `initiateKall`                            | `0` new                                                                  | `call-caller`                       | FR-KL-001          | `docs/kall-flow.md:32`    |
| `0` new       | `updateKallStatus`                        | `1` connected / `2` cancelled / `3` noresponse / `4` declined / `5` busy | `call-caller` or `call-participant` | —                  | `docs/kall-flow.md:34`    |
| `1` connected | `endIndividualKall`                       | `8` closed                                                               | `call-caller`                       | —                  | `docs/kall-flow.md:35`    |
| —             | `scheduledKall`                           | `6` Scheduled                                                            | `call-caller`                       | FR-KL-003          | `docs/kall-flow.md:43`    |
| `6` Scheduled | `reScheduleKall`                          | `7` ReScheduled, **same `kallID`**                                       | `call-caller`                       | BR-C01 / FR-KL-004 | `docs/kall-flow.md:43-44` |
| any           | `clearKallBykallIds` / `clearKallHistory` | `deletedBySender: true`                                                  | `call-caller`                       | —                  | `CLAUDE.md:3071-3072`     |

No documented transition produces `9 removed`, `10 KoolKall Accepted` or `11 Not Joined`.

### 5.3 Group

| From               | Action                                 | To                                        | Actor                | Requirement  | Evidence                                |
| ------------------ | -------------------------------------- | ----------------------------------------- | -------------------- | ------------ | --------------------------------------- |
| —                  | `createUserGroup`                      | group exists, creator `hasAdminAccess: Y` | `group-admin`        | FR-GC-*      | `group.api.ts:43-48`                    |
| non-member         | `addUserToGroup`                       | member, `hasAdminAccess: N`               | `group-admin`        | FR-GM-010    | `group.api.ts:22-30`                    |
| member (`N`)       | `addOrRemoveAdminAccess` `Y`           | `group-admin`                             | `group-admin`        | FR-GM-012    | `group.api.ts:97-112`                   |
| admin (`Y`)        | `addOrRemoveAdminAccess` `N`           | `group-member`                            | `group-admin`        | FR-GM-013    | same                                    |
| member             | `removeGroupMember` / `leaveFromGroup` | `removedFlag: true`                       | `group-admin` / self | FR-GM-011    | `group.api.ts`                          |
| group with members | `deleteGroup`                          | **refused** until all members removed     | `group-admin`        | FR-GC-delete | `group.api.ts:11-12` — verified on live |

**The one group invariant with a state precondition:** FR-GM-014 — a sole admin cannot exit. Asserted
only as `exit.status >= 400` ([tests/api/kpost/group/feature.spec.ts:163](../tests/api/kpost/group/feature.spec.ts#L163)),
with the admin set never re-read.

### 5.4 KMail

| From            | Action            | To                                                            | Actor       | Evidence                         |
| --------------- | ----------------- | ------------------------------------------------------------- | ----------- | -------------------------------- |
| —               | `postMail`        | transaction per recipient, `deliveryStatus Y`, `readStatus N` | `sender`    | `sentMailNotOpened` sample       |
| `readStatus N`  | recipient opens   | `readStatus Y` + `letterReadTime`                             | `recipient` | `sentAndInboxMailContent` sample |
| `replyStatus N` | recipient replies | `replyStatus Y` + `letterReplyTime`                           | `recipient` | same                             |
| any             | delete            | `deleteBySender` / `deleteByReceiver` `Y`                     | either      | `docs/kmail-flow.md:41`          |

KMail is the **only** module whose documented state distinguishes delivery from reading, and whose
read state is broken out per recipient for a non-group mail.

---

## 6. Deliverable C — Observation inventory

### 6.1 Katchup

| Resource / state                                                       | Observation mechanism                                                                      | Existing support                                                               | Gap                                                                            |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| message `status`, `readTime`, `deletedBy`, `importantBy`, `isVanished` | **API read-back** — `katchupMessagesForSelectedContactID`                                  | **Registered + `productionSafe` + runs on live** (`docs/LIVE-ENDPOINTS.md:85`) | **No test reads any field**                                                    |
| same                                                                   | `searchKatchUpMessage`, `filterKatchUpMessage`, `homeDashboardMsgs`, `katchupDashboardMsg` | all `productionSafe`, run on live                                              | never read                                                                     |
| initial state on creation                                              | **the `sendMessage` response itself** carries the row                                      | already called by every lifecycle                                              | never read                                                                     |
| per-recipient receipt                                                  | `getReadStatusGroupMessage`                                                                | registered, `needs-message-id` + `needs-group`                                 | **group only**; asserted as `status === 200`                                   |
| unread count                                                           | `getUnopenedMessagesCount`                                                                 | `productionSafe`, live                                                         | aggregates **per sender**, not per message — cannot answer "is message X read" |
| "recipient reads message" (the act)                                    | —                                                                                          | —                                                                              | **No endpoint exists.** UI side effect only                                    |
| recalled / edited                                                      | body-text presence/absence; UI `Edited` string                                             | one soft text assertion each                                                   | no state field; UI-only for the marker                                         |
| vanishing actually disappears                                          | —                                                                                          | —                                                                              | **No mechanism**                                                               |

### 6.2 Kall

| Resource / state                                  | Observation mechanism                                    | Existing support                                     | Gap                                                                                      |
| ------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `kallStatus` / `senderKallStatus`                 | `todayKoolKall`, `kallDashboard` (both `productionSafe`) | registered, live                                     | **used by no test**; the 6→7 observation in `CLAUDE.md:3063` was a **manual** inspection |
| `kallStatus` by id                                | `getKallStatus`, `getKallStatusUsingKallID`              | registered, `needs-kall-id`, driven by the lifecycle | tests assert HTTP only; body never parsed                                                |
| participant `joinedStatus` / `receiverKallStatus` | present in response samples                              | —                                                    | contract-only; zero code references                                                      |
| `deletedBySender`                                 | returned                                                 | —                                                    | observed manually once; never asserted                                                   |

### 6.3 Group, KMail, KDiary, attachment

| Resource / state                                    | Observation mechanism                                                                                                 | Existing support                                               | Gap                                                                                               |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| group membership / admin                            | **none**                                                                                                              | **No group read endpoint exists in the documented API at all** | `uncoveredGroupPaths()` is empty — the workbook documents 11 group endpoints, none of them a read |
| group mutations                                     | mutation responses return **prose** (`"Admin added successfully"`)                                                    | —                                                              | a prose string cannot evidence a state                                                            |
| KMail per-recipient `readStatus` / `letterReadTime` | `sentAndInboxMailContent` (`kmail-mail-content`), `sentMailNotOpened` (`kmail-sent-not-opened`, **`productionSafe`**) | registered, live                                               | **no test reads the transaction list's state fields**                                             |
| KDiary event state                                  | `kdiary-get-events`                                                                                                   | registered                                                     | read only to pick rows to delete; nothing asserted                                                |
| attachment existence                                | `checkAttachmentS3`                                                                                                   | registered                                                     | **never called in the lifecycle**; no before/after check                                          |

### 6.4 The summary that matters

Of the state-bearing observation mechanisms above, **the overwhelming majority already exist, are
registered, and already run against the live application.** The gap is almost never "we cannot see it";
it is "nothing looks".

The two genuine mechanism gaps are:

1. **No endpoint marks a 1:1 Katchup message read** — so the bench cannot _cause_ the transition.
2. **No group read endpoint exists** — so group state cannot be observed at all.

---

## 7. Deliverable D — Conflicts (preserved, not resolved)

Recorded in the style of the Phase 1 registry
([src/requirements/conflicts.ts](../src/requirements/conflicts.ts)), which already holds two related
entries (`CONF-CONTRACT-RECALL-PAYLOAD`, `CONF-CONTRACT-MESSAGETYPE-2`). **None of these is resolved
here.**

### 7.1 `katchupStatus` conflates a lifecycle state with a conversation-kind discriminator

`0 Sent`, `1 Unread`, `2 Read`, `3 Not sent` describe a message's delivery/read lifecycle. `4 Group`
describes _what kind of conversation the row belongs to_ — and the bench sends it as a routing value
(`status: KATCHUP_STATUS.group`,
[tests/api/kpost/katchup/feature.spec.ts:291](../tests/api/kpost/katchup/feature.spec.ts#L291)).
One field, two orthogonal meanings. A group message therefore has **no representable read state** in
this field. Unresolved.

### 7.2 `kallStatus`: numeric code vs string label

`contracts/kpost-types.json:40-53` numbers the states (`6` = Scheduled). Every documented response
sample returns a **string** (`"kallStatus": "Scheduled"`, `"new"`, `"closed"`), while the live run
recorded in `CLAUDE.md:3064` observed a **numeric** `senderKallStatus: 7` on a different field name.
Three representations; no source reconciles them. Unresolved.

### 7.3 Did BR-C01's status transition actually occur on live?

| Source                                                                                   | Claim                                                                                                               |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `CLAUDE.md:3062-3064`                                                                    | "sender status moves **6 (Scheduled) → 7 (ReScheduled)** — seen in the `todayKoolKall` row (`senderKallStatus: 7`)" |
| `docs/kall-flow.md:95-96`                                                                | same                                                                                                                |
| `docs/requirements-frd.md:98`                                                            | "senderKallStatus 6→7 asserted on live"                                                                             |
| [tests/api/kpost/kall/feature.spec.ts:223](../tests/api/kpost/kall/feature.spec.ts#L223) | "(On the current build it **stays 6 = Scheduled** — part of the defect.)"                                           |

Three documents say the transition was observed; the test that checks it says it does not happen.
**Unresolved, and material** — it is the repository's flagship state-transition claim.

### 7.4 `kmailType`: numeric enum vs free string

Numeric on send (`KMAIL_TYPE.new` = 0,
[send.api.ts:31](../src/api/definitions/kmail/send.api.ts#L31)); free string on reads
(`kmailType: 'Received'`, [read.api.ts:414](../src/api/definitions/kmail/read.api.ts#L414);
`'sent'`, [manage.api.ts:114](../src/api/definitions/kmail/manage.api.ts#L114)). Unresolved.

### 7.5 Is BR-M01 (KMail read receipts) covered?

`docs/requirements-frd.md:123` marks FR-KM-020 **COVERED**; `docs/business-rules.md:76` marks the same
rule **⬜ to-do**. The COVERED claim is wired into
[send.api.ts:53](../src/api/definitions/kmail/send.api.ts#L53) (`requirements: ['FR-KM-018', 'FR-KM-020']`)
— i.e. _sending_ a mail is tagged as satisfying _read receipts_. Unresolved.

### 7.6 BR-X01 parity claim vs representational divergence

BR-X01 states read receipts behave identically in Katchup and KMail (`CLAUDE.md` §2;
`docs/business-rules.md:104`). The contracts show two different models: Katchup uses a single
`status` enum plus `readTime` on the message, with per-recipient breakdown **only for group**; KMail
uses a per-recipient `kmailTransactionList` with `readStatus` + `letterReadTime` for every mail.
Whether "identically" refers to user-visible behaviour or to the data model is unresolved.

### 7.7 Delete payload divergence inside the bench itself

[manage.api.ts:42-45](../src/api/definitions/kpost/katchup/manage.api.ts#L42) states the field is
`messageIds` (an array) and that "Sending `msgID` is the wrong shape and can leave the message
undeleted (orphan)". [lifecycle.spec.ts:137](../tests/api/kpost/katchup/lifecycle.spec.ts#L137) sends
`{ msgID, groupFlag: false }` under the test name _"delete removes it entirely (FR-K20)"_, asserting
only `status < 300`. This is a bench defect, not an application-state conflict — flagged here, **not
fixed** (out of scope for a discovery phase).

### 7.8 `status: 5` on recall

Already recorded as `CONF-CONTRACT-RECALL-PAYLOAD` in Phase 1: the workbook sample sends
`status: 5`, which is not a valid `katchupStatus` (the enum stops at 4). Still unresolved.

---

## 8. Deliverable E — Katchup 1-to-1 lifecycle analysis

Against the Phase 2B proof-of-concept
([src/flows/catalogue/katchup-message-1to1.ts](../src/flows/catalogue/katchup-message-1to1.ts)).
**Nothing below is implemented.**

### 8.1 State at each step

| Flow step                      | Application state before | Transition                               | State after                                        | Documented?                            | Observable today?                                  |
| ------------------------------ | ------------------------ | ---------------------------------------- | -------------------------------------------------- | -------------------------------------- | -------------------------------------------------- |
| `authenticate-sender`          | —                        | login                                    | session (category A? no — session is not modelled) | n/a                                    | n/a                                                |
| `authenticate-recipient`       | —                        | login                                    | —                                                  | n/a                                    | n/a                                                |
| `send-message`                 | message does not exist   | `sendMessage`                            | `status: 0` Sent, `readTime: null`                 | **Yes**                                | **Yes** — the send response itself carries the row |
| `recipient-observes-message`   | `0` Sent                 | _(none — observing is not a transition)_ | unchanged                                          | n/a                                    | **Yes** — conversation read, runs on live          |
| `recipient-reads-message`      | `0` Sent / `1` Unread    | recipient opens the thread               | `2` Read + `readTime`                              | **Yes** (`docs/katchup-flow.md:24-26`) | **No endpoint causes it**; UI side effect only     |
| `sender-observes-read-receipt` | `2` Read                 | _(none)_                                 | unchanged                                          | **Yes**                                | **Probably yes, unverified** — see §8.3            |

### 8.2 What the Flow Model can and cannot prove — restated precisely

Phase 2B recorded two `unboundReason`s. Both remain true, and both need sharpening:

**Step 5 — `recipient-reads-message`.** Phase 2B: _"No endpoint marks a 1:1 Katchup message read."_
**Confirmed.** A search of the full documented contract (not merely the registered subset) for
`read|open|seen|status` returns no Katchup mark-read endpoint. The transition is real and documented
but **cannot be caused through the API**. This is a genuine, permanent API gap for the bench: driving
it requires the UI.

**Step 6 — `sender-observes-read-receipt`.** Phase 2B: _"No 1:1 read-receipt endpoint is registered."_
**True as written, but incomplete, and the incompleteness matters.** There is no _dedicated_ 1:1
receipt endpoint — `getReadStatusGroupMessage` is group-only and `getUnopenedMessagesCount` aggregates
per sender. **However**, the 1:1 conversation read returns `status` and `readTime` **per message**, and
that endpoint is `productionSafe` and runs on live today.

So the honest statement is:

> The read **state** is documented and, on the evidence of the response contract, retrievable through
> an endpoint the bench already calls. What is missing is (a) an API way to _cause_ the read, and
> (b) any code that _reads the field_.

### 8.3 The one ambiguity that must not be resolved by assumption

The documented conversation sample contains messages in both directions and shows `status: 2` with a
populated `readTime` on a message the sample's subject **sent**. That is consistent with "the sender
can see the recipient's read time", which is what FR-K07 needs. But the sample does not record **which
account made the call**, so whose perspective the `readTime` reflects is **UNKNOWN**. Resolving it
requires one gated live observation, not a reading of the contract. Recorded as an open question, not
an answer.

### 8.4 Where the existing tests overclaim

Verified individually:

| Test                             | Claim in the name                                          | Actual assertion                                                             |
| -------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `lifecycle.spec.ts:123`          | "recall **removes it from the recipient view**"            | `status < 300` only — no read-back                                           |
| `lifecycle.spec.ts:133`          | "delete **removes it entirely**"                           | `status < 300`, with the payload shape its own definition calls wrong (§7.7) |
| `feature.spec.ts:208`            | "read receipts **are tracked**"                            | `expect.soft(receipts.status).toBe(200)`                                     |
| `katchup-two-session.spec.ts:71` | "**marks a read receipt**"                                 | subject text visible on both sides                                           |
| `src/ui/katchup-features.ts:113` | read receipt "+ open state" → `status: 'built'`            | open state asserted nowhere; propagated into `docs/KATCHUP-UI-COVERAGE.md`   |
| `docs/requirements-frd.md:54`    | FR-KU-017..024 COVERED incl. "countdown" and "auto-delete" | neither asserted                                                             |

The circular deferral Phase 2A identified is confirmed and now fully traced: the API test defers to the
UI ([feature.spec.ts:306](../tests/api/kpost/katchup/feature.spec.ts#L306)), the UI test defers back to
the API ([katchup-two-session.spec.ts:90-91](../tests/e2e/katchup-two-session.spec.ts#L90)), and the API
test it names asserts only a status code.

**Note on scope:** the `feature.spec.ts` recall test _does_ read back (absence of a marker string in the
conversation body text, softly) — so the recall behaviour is not entirely unverified. It is
`lifecycle.spec.ts` that overclaims. The two specs disagree with each other.

---

## 9. Deliverable F — Kall and Group cross-check

### 9.1 Kall — the abstraction generalises well

Kall exhibits the same shape as Katchup, independently:

- a **resource-level status** from a closed enum (`kallStatus`, 12 codes),
- a **per-participant sub-state** (`kallAcceptStatus`, `joinedStatus`, `receiverKallStatus`),
- a **deletion marker** (`deletedBySender`, mirroring Katchup's `deletedBy`),
- **timestamps** bracketing the lifecycle.

It also has something Katchup lacks: a **documented transition sequence**
(`docs/kall-flow.md:32-37`), with named actions and explicit from→to codes. That makes Kall the best
available proving ground for a transition model.

Caveats recorded honestly: `1 connected` is unreachable headlessly; three enum codes have no documented
transition; and the module's flagship transition claim is itself contested (§7.3).

### 9.2 Group — the abstraction does **not** generalise, for a structural reason

Group has membership state (`hasAdminAccess`) and a genuine state-dependent invariant (FR-GM-014,
min-one-admin). But:

- there is **no group read endpoint in the documented API** — the workbook documents 11 `/v2/group/*`
  paths and every one is a mutation or an image download;
- mutations return **prose**, not state (`"Admin added successfully"`);
- no group enum exists in the types contract.

So group state is, on today's evidence, **unobservable through the API**. A state model could _declare_
group states, but nothing could ever confirm one. Modelling it now would produce exactly the
unfalsifiable green this bench exists to avoid.

**Verdict:** the abstraction generalises to Kall and KMail. It does **not** generalise to Group until
either a group read endpoint is documented or UI observation is accepted as evidence.

---

## 10. Deliverable — state-model gaps (brief §8)

1. **States with no observation method:** all group states; attachment existence; whether a vanishing
   message actually disappeared; Katchup `1 Unread` and `3 Not sent` (never seen in any sample).
2. **Transitions with no executable endpoint:** "recipient reads a 1:1 Katchup message" (the sole
   confirmed permanent API gap); disappearing-message expiry (time-driven, no actor).
3. **Transitions observable only through the UI:** the 1:1 read; the `Edited` marker; the sender-side
   "recalled" marker (named in prose at `CLAUDE.md:2618`, located by no selector).
4. **Transitions observable only through the API:** confidential-copy invisibility (NFR-SEC02);
   per-recipient KMail read status; group-delete ordering.
5. **Terminology conflicts:** §7 — eight, all unresolved.
6. **Requirements describing behaviour with no state terminology:** FR-GM-010/011/012 (count-based
   assertions with no state field to count); FR-KL-008/009 (call-log contents).
7. **Tests claiming state behaviour while checking only HTTP:** §8.4, plus — measured from
   `docs/business-rules.md` — **13 of 48 catalogued rules are marked 🟡 "partial (only 'accepted', or
   UI-only)"** and 20 are ⬜ to-do. The repository already tracks this honestly; it has simply never had
   a mechanism to fix it.
8. **Ledger states confusable with application states:** §2.1 — `CLEANED` vs `deletedBy` is the live
   hazard, because both are about "a message that is gone" while meaning different things about
   different subjects.

---

## 11. Deliverable G — Proposed minimal State Model

### 11.1 Can a minimal common abstraction be defined? Yes — for three resources

The evidence supports a model for **Katchup message**, **Kall**, and **KMail mail transaction**. It does
**not** support one for Group (§9.2), KDiary (enum exists, never used), attachments (no vocabulary) or
drafts (an id, not a state). Those should be recorded as out-of-scope, not modelled thinly to look
complete — the same discipline Phase 3 applied to `call-host`.

### 11.2 The minimal shape

Four declarative concepts, and nothing else:

```
StateVocabulary    a resource family + its closed set of documented states,
                   each carrying provenance and a DOCUMENTED|OBSERVED|DERIVED|UNKNOWN|CONFLICTED status

StateTransition    from → action → to, with the documented ActorRoleId and requirement ids

Observation        how a state COULD be read: the endpoint id + the response field path,
                   plus whether that endpoint runs on live today

StateConflict      a preserved disagreement between sources (never resolved silently)
```

### 11.3 Why this is sufficiently source-backed

- The **vocabularies already exist as data** in `contracts/kpost-types.json`, generated from the
  owner's authoritative workbook. The model would _reference_ them, not restate them — the same
  relationship `src/api/schemas/kpost-types.ts` already has.
- The **transitions** are quoted from `docs/kall-flow.md:32-44` and `docs/katchup-flow.md:24-26`.
- The **observations** are endpoint ids that already exist in the registry and response field paths
  that already appear in documented samples.
- The **actor** for each transition is an existing `ActorRoleId` — no new vocabulary.
- The **conflicts** have a precedent and a home: Phase 1's `RequirementConflict`.

Every field is a citation of something already in the repository. Nothing requires a new fact.

### 11.4 What it must not contain

No execution, no HTTP, no UI driving, no database query, no authorization, no failure classification,
no confidence, no Bugzilla, no flow execution, and no replacement of the resource ledger, `FlowRun` or
artifact state. It would be a **description**, checked by a guard that every referenced endpoint id,
requirement id and actor role resolves — exactly as the Flow Model's guard does today.

An explicit non-goal: it must not compute whether a state is "correct". Judging an observed value
against an expectation is assertion work, and it belongs to the specs and the validators that already
do it.

---

## 12. Deliverable H — Architectural risks

| #   | Risk                                                      | Why it is real here                                                                                            | Mitigation                                                                                                                                                   |
| --- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Application state confused with ledger state**          | Both concern "a message that is gone"; the ledger already uses the word `CLEANED` and the app uses `deletedBy` | Different type names, no shared vocabulary, a guard asserting the state module imports nothing from `src/test-data/`                                         |
| 2   | **Application state confused with flow execution status** | Phase 2C already had to separate `BLOCKED` from `PRECONDITION_FAILED`                                          | Application states are lower-case/product-shaped (`Sent`, `Read`); execution statuses stay UPPER_SNAKE                                                       |
| 3   | **A second failure-classification system**                | A "state mismatch" is tempting to classify                                                                     | The state model reports _what state was documented and where it could be read_ — never whether a mismatch is a defect. That is the existing classifier's job |
| 4   | **Artifact availability confused with state**             | `MESSAGE_ID` being present is not the message being `Sent`                                                     | Artifacts stay in `FlowRun`; the state model never stores a runtime value                                                                                    |
| 5   | **Declaring states nothing can observe**                  | Group is precisely this case                                                                                   | Every state carries an `Observation` or an explicit recorded gap — the `unboundReason` pattern Phase 2B already uses                                         |
| 6   | **Silently resolving a conflict**                         | Eight live conflicts, several tempting to "normalise" (e.g. numeric vs string `kallStatus`)                    | Conflicts are first-class records, as in Phase 1; the model stores both readings                                                                             |
| 7   | **Overclaiming from a documented sample**                 | §8.3 — the sample's caller perspective is unknown                                                              | `DOCUMENTED` ≠ `OBSERVED`; the status field forces the distinction                                                                                           |

---

## 13. Deliverable I — Recommendation

**Implement a minimal, narrow State Model in Phase 4B — scoped to Katchup message, Kall, and KMail mail
transaction — and nothing else.**

Reasoning:

- A **further discovery phase is not warranted.** The vocabularies, transitions and observation points
  are all already in the repository as data; more reading will not produce more evidence. The one
  remaining unknown (§8.3, whose `readTime` the conversation read reflects) needs a _gated live
  observation_, not analysis.
- A **fully generic framework is not warranted either.** Group fails the observability test outright,
  and KDiary/attachments/drafts have no usable vocabulary. Building for them would mean inventing.
- The **narrow model pays for itself immediately**, because the binding constraint is not missing
  endpoints. It is that state-bearing responses the bench already receives, on endpoints that already
  run on live, are read by nothing. A model that says _"`katchup.message.Read` is observable at
  `katchup-conversation` → `data[].status`, and `readTime` should be non-null"_ converts roughly a
  dozen status-code assertions into behavioural ones without adding a single request.

Suggested Phase 4B boundary, for the owner to approve or narrow further:

1. Declare the three vocabularies by reference to `contracts/kpost-types.json`.
2. Declare the transitions quoted in §5.1, §5.2 and §5.4, each with its `ActorRoleId` and requirement ids.
3. Declare observations as `(endpointId, responseFieldPath, runsOnLive)` — **declaration only, no reads**.
4. Record every §7 conflict as a first-class unresolved record.
5. Add a guard that every referenced endpoint id, requirement id and actor role resolves.

Explicitly **not** in Phase 4B: causing transitions, asserting states, migrating any test, touching
Group, or resolving any conflict.

---

## 14. Verification

This phase introduced no source file, no schema and no guard, so there was nothing new to test. The
existing gates were run to confirm the repository is unchanged:

| Check                                                   | Result                                        |
| ------------------------------------------------------- | --------------------------------------------- |
| `npm run typecheck`                                     | exit 0                                        |
| `npm run lint`                                          | 0 errors, 32 warnings (the standing baseline) |
| `npx playwright test --project=framework`               | 547 passed, 4 skipped                         |
| `MOCK_API=true npx playwright test --project=framework` | 551 passed                                    |

No live or destructive KPOST test was run. Bugzilla was not enabled. Confidence enforcement was not
modified. Nothing was committed or pushed.

---

AUDIT_STATUS: discovery complete; no implementation performed
UNRESOLVED_CONFLICTS: 8 (§7), all preserved, none resolved
OPEN_QUESTION_REQUIRING_LIVE_OBSERVATION: 1 (§8.3)
