# Katchup Module — Ground-Truth Coverage Report (2026-10-03)

Built by reading the actual backend (`KPOST_V5.0`) and frontend (`KPOST_REACTJS_2023_V1`) source code directly, then cross-referencing against the test bench's current coverage. This is the baseline for bringing Katchup to genuine 100% production-grade coverage, API and UI both.

**Scope read**: `KatchupController(V2).java`, `KatchupServiceImpl.java`, `KatchupDaoImpl.java`, `KatchupRepository.java`/`KatchupAttachmentRepository.java`, all Katchup entity/DTO classes, `GroupController(V2).java`/`GroupServiceImpl.java`/`GroupServiceDaoImpl.java`, `PresignedURLController.java`, `AWSs3ClientServiceImpl.java`, `FireBaseServiceImpl.java`, `SecurityConfiguration.java`, async/scheduler config — backend side. `Katchup.js` (router), the full `components/`+`bubble/`+`classic/` trees, `Services/Katchup.js` — frontend side.

---

## 0. Executive summary

- **Backend**: 32 Katchup + 12 Group + 5 presigned/AWS endpoints = **49 real endpoints**. Bench currently defines 44 of them (all Katchup+Group; the AWS presigned ones are separately covered under `aws/*`).
- **Frontend**: 3 parallel component trees exist, but **2 of them (`bubble/Katchup.js`, `classic/Katchup.js` top-level pages and most of their subtrees) are dead code** — never imported by the live router. Only the message-thread/composer is skin-swapped (bubble default, classic opt-in via localStorage); everything else (left panel, DigitalCard) is single-sourced.
- **Confirmed CRITICAL security findings (live-testable today): 8.** Confirmed CRITICAL backend-only findings needing live verification: 6 more. Total ~14 high-value security gaps found by reading source that the bench did not know about before today.
- **Confirmed non-functional/dead UI features that must NOT be test-coverage targets**: Report Contact (stub, no backend call), Advanced Search (both the left-panel and in-thread versions — 100% mock data), Widgets tray, Diary, Map, Messagewithcopies, ProfilePage (orphaned import), Block/Delete/Report-Contact UI inside the left panel tree (only reachable via Digital Card).
- **5 live `debugger;` statements** ship in production code paths that fire on common actions (delete message, bell-menu click, group name edit, add-contact, unopened-message click).

---

## 1. API endpoint inventory — Katchup + Group + Attachments

Legend: **Auth**=endpoint requires a valid token; **Scoped**=the code verifies the caller is actually a participant/owner/admin of the resource, not just logged in. "NO" in Scoped is a finding, not a formatting choice.

### 1a. Katchup messaging (`KatchupControllerV2.java`, base `v2/katchup`)

| Endpoint | Auth | Scoped | Bench coverage | Notes |
|---|---|---|---|---|
| POST sendMessage | Y | Y (sender forced) | `send.spec.ts` | `@Valid` enforced here only |
| POST sendKatchupMsgMultiPart | Y | Y | `attachment-workflow.spec.ts` | |
| POST sendMessageForForwardSelectedAttachment | Y | **PARTIAL** | `send-regression.spec.ts` | **`sender` taken from request body, not token** — spoofable |
| POST sendBulkKatchupMsg / sendBulkKatchupMsgMultiPart | Y | Y | `lifecycle.spec.ts` | |
| POST forwardKatchupMessage / forwardKatchupMessageNew / forwardKatchupMultipleMsgs | Y | Y (latter two have explicit `countAccessibleMessages` IDOR gate) | `feature.spec.ts` | `forwardKatchupMultipleMsgs` is the hardened reference implementation |
| GET katchupMessagesForSelectedContactID | Y | Y for current members, **NO live-membership re-check** | `reads-workflow.spec.ts` | Removed/left group members still see full history — see §3 |
| POST recallMessage | Y | **NO (1:1: receiver can recall too) / NO (group: no sender check at all)** | `login-flow`-style spec exists for #945 | **Mutation-level BOLA — see §4 priority list** |
| POST markOrUnmarkImportantMessage | Y | Y (1:1, independent per-side flags) / PARTIAL (group: self-scoped but always "success") | `feature.spec.ts` | |
| POST deleteKatchUpMessage | Y | Y (app-layer bucketing, not SQL WHERE) | `feature.spec.ts` | Soft-delete only, never touches S3 |
| POST saveKatchupMessages | Y | Y (self-scoped) | `coverage.spec.ts` (generic sweep only) | **Misleadingly named — see §4, it's a destructive "delete everything except" op with no empty-list guard** |
| GET getReadStatusGroupMessage | Y | **NO** | none dedicated | IDOR — returns full group read-status for any msgID |
| GET getKatchupMessagesSubject/{id} | Y | **NO** | `needs-id-workflow.spec.ts` (fixed today, but only re path-param bug — not the IDOR) | `sender`/`receiver` arbitrary, no cross-check |
| GET frequentlyAccessContacts | Y | Y | `reads-workflow.spec.ts` | |
| GET getUnopenedMessagesCount | Y | Y (scoped) but **JPQL string-concat injection risk** | `read.spec.ts` (generic sweep) | `KatchupDaoImpl.java:364-365` — priority injection probe target |
| GET getUnopenedMessagesAndKmailsTotalCount | Y | Y | `read.spec.ts` | Stored procedure, logic opaque |
| POST searchKatchUpMessage | Y | Y (best-scoped query in the file) | `send.spec.ts`-adjacent | |
| POST searchKatchUpMessageSubject | Y | **NO** | `send.spec.ts` | `sender`/`receiver` arbitrary strings |
| POST katchupSearch / searchMsgIds | Y | Y | none dedicated | **Inconsistent with searchKatchUpMessage: doesn't exclude expired-secret or recalled messages** |
| POST filterKatchUpMessage | Y | Y (messageBy whitelist = the KP-818553 fix) | `coverage.spec.ts` | Live-verify the fix holds |
| GET getAllReportMsg | Y | **NO role check — returns ALL users' abuse reports** | none | Priority finding |
| POST reportAbuse | Y | PARTIAL (reporter forced, no check msgID was seen by reporter) | none | |
| POST getSharedMessageInfo | Y | Y (hardened, 404-not-403 by design) | `shared-reference-workflow.spec.ts` | Reference implementation — but leaks hidden/revealed recipient metadata to any participant |
| POST getBulkMessageInfo | Y | **NO — `sender` param accepted, never checked** | `shared-reference-workflow.spec.ts` | **Priority IDOR — join key is `System.currentTimeMillis()`, enumerable** |
| POST getMessagesByReferenceMessageList / getReferenceMessagesDetails / getReferenceMSGDetails | Y | **NO** (all three) | `shared-reference-workflow.spec.ts` | Systemic family — full message content, zero participant check |
| POST forwardMessageBacktrackByMsgID | Y | Y — explicit admin-only gate (hardcoded `info@kpost.in`) | none | V2 path is gated; confirm no equivalent ungated path exists |
| POST changeCaption | Y | **NO** | none | Any caller can rewrite caption on any message's reference IDs |
| POST patchWorkForGroup | Y | Y — explicit admin-only gate | none | Maintenance endpoint, correctly hardened |
| POST generateThumbnailUsingUUID | Y | **NO** | none | No participant check on supplied UUIDs |
| GET downloadAttachment/{uuid} | **NO — `permitAll()`** | **NO** | `katchup-attachment-idor.spec.ts` (confirmed live today) | **CRITICAL — public, zero auth** |
| GET downloadThumbnail/{uuid} | **NO — `permitAll()`** | **NO** | `katchup-attachment-idor.spec.ts` (confirmed live today) | **CRITICAL — public, zero auth, worse than above (no header check of any kind)** |
| GET oldDownload/{uuid}, download/{uuid}, mediaStreaming/{uuid} | Y (header presence only) | **NO** | `katchup-attachment-idor.spec.ts` (confirmed live today) | kpostID passed to service only as a `type` string, never for auth |
| GET downloadFromS3/{uuid} | Y | **YES — reference implementation** (KP-ATTACH-IDOR) | `katchup-attachment-idor.spec.ts` (timed out in my live run — inconclusive, needs retry) | The ONE correctly-guarded attachment route |
| POST uploadMultipartFiles | Y | N/A | `attachment-workflow.spec.ts` | |
| GET getDeletedKatchupMsgIds/{lastMsgID} | Y | Y (scoped) | none | Historical binding bug (path var name mismatch) fixed — confirm live |

### 1b. Group (`GroupControllerV2.java`, base `v2/group`, + legacy `GroupController.java` base `group`)

| Endpoint | Auth | Scoped | Bench coverage | Notes |
|---|---|---|---|---|
| POST createUserGroup (V1+V2) | Y | N/A | `coverage.spec.ts` | V2 has real validation; V1 has none |
| POST addUserToGroup (V1+V2) | Y | Y — admin only | `feature.spec.ts` | `@Valid` on V2 is a no-op for nested member validation |
| **POST group/removeGroupMember (V1 — legacy, STILL LIVE)** | Y | **NO — zero check, hard DELETE** | none | **CRITICAL — see §4. Do not test against real groups.** |
| POST v2/group/removeGroupMember | Y | Y — owner OR co-admin, soft-delete | `feature.spec.ts`, today's #945 work | Correctly hardened (KPA-507 fix) |
| POST addOrRemoveAdminAccess | Y | Y — **owner only**, not co-admins | `coverage.spec.ts` | Asymmetric vs. remove-member (co-admins CAN remove but CANNOT promote) — worth a coverage note, likely intentional |
| POST leaveFromGroup | Y | Y — self only (kpostID-matched fix) | `coverage.spec.ts` | |
| POST updateGroupProfileImage / removeGroupProfileImage | Y | PARTIAL — any member, not just admin | none | Error message says "1 MB", actual limit is ~0.5 MB |
| GET downloadGroupProfileImage/{groupKpostID}/{kpostID} GET downloadGroupFullProfileImage/{...} | Y | **NO** | none | `kpostID` path segment never compared to caller |
| POST editGroupName | Y | PARTIAL — any member, not just admin | `feature.spec.ts` | |
| GET getGroupDetailsUsingGroupKpostID/{groupKpostID} | Y | **PARTIAL/leaky** — doesn't require caller to be a group member if the admin is a personal contact of the caller | none | Needs a dedicated live test (see §4) |
| POST deleteGroup | Y | Y — self-membership-state-driven | `feature.spec.ts` | Owner cannot disband a populated group in one call (by design, confirmed) |

### 1c. Presigned URL / S3 (`PresignedURLController.java`, base `v2/aws`)

| Endpoint | Auth | Scoped | Bench coverage | Notes |
|---|---|---|---|---|
| POST katchup/generate-presigned-url | Y | Y (own upload) | `presigned-attachment-workflow.spec.ts` | **No extension allow-list** (the sibling Kmail endpoint has one, this doesn't); no file-size cap anywhere; all uploads get `PublicRead` ACL |
| GET deleteAttachmentFromS3/{uuid} | Y | Y | `presigned-attachment-workflow.spec.ts` | |
| GET/POST checkAttachmentS3 | Y | Y | `presigned-attachment-workflow.spec.ts` | |

---

## 2. Business rules confirmed from source (new/updated vs. `docs/business-rules.md`)

1. **Sender ≠ receiver** enforced server-side on every send/forward path (400 if equal).
2. **A group message cannot be recalled once any OTHER member has read it** — but the "other member" check has no sender-identity verification (see §4).
3. **"Secret" message (messageType 18) has no implementation found in the service layer at all.** The only secret/vanish logic found is a read-time filter in `katchupMessagesForSelectedContactID` (removes expired/vanished secrets from the response) — the write/expiry-setting path was not found in the files read (likely in `KpostWelcomeMailAndMessage`, out of scope). **The frontend DOES implement a full "Confidential Message" compose-time feature (delete-after-read / delete-on-countdown)** — so this is real and UI-reachable; the backend expiry enforcement needs to be chased down and verified end-to-end, because right now there's no confirmed proof it's enforced anywhere except that one read path.
4. **Soft-delete only, always** — no message or attachment is ever hard-deleted via the katchup API. `deletedBySender`/`deletedByReceiver`/`isVanished` are the flags; S3 objects are never cleaned up on delete.
5. **1:1 vs group recall UX genuinely differs**: a recalled 1:1 message stays visible (messageType flipped to 7, shown as a placeholder); a recalled group message is filtered out of the fetch entirely for everyone.
6. **Removed/left group members keep read access to message history** — only new sends are blocked (`GroupReadStatus` rows are never cleaned up on removal/leave). This contradicts the intuitive "removed = no more access" expectation.
7. **Group business rules**: no min/max member count anywhere; group name uniqueness is per-admin not global (two different admins CAN create identically-named groups); `groupKpostID`'s random suffix has only 900 possibilities with no collision retry; `isPrivateGroup` field is completely unused (dead); owner role is never transferable; a populated group cannot be disbanded in one call (must remove everyone first).
8. **Forward limits differ between messaging and group creation**: forward caps at 5 messages / 10 recipients (bubble) or 10 messages / uncapped recipients (classic, confirmed inconsistent with bubble — see §UI).
9. **`GroupFlagDeserializer`** normalizes boolean-or-"Y"/"N"-or-"true"/"false" (any case) into canonical strings; 400s on anything else — a documented fix (KP-4EB0BB) worth a full input-shape regression test.

---

## 3. Database layer — key findings

- **`KatchupMessages`/`GroupReadStatus`/etc. have zero JPA-enforced foreign keys** — every "relationship" (sender/receiver/group/msgID references) is a loose string/long match with no referential integrity. A sender/receiver value can point to a non-existent kpostID with no constraint violation.
- ~~**JPQL injection risk**~~ **CHECKED 2026-10-03, not practically exploitable.** `KatchupDaoImpl.java:364-365` (`getUnopenedMessagesCount`) does concatenate `receiverID` raw into a JPQL UPDATE — a genuine code-quality defect (the only query in the DAO breaking the parameterized-query pattern), but `receiverID` is always the caller's own JWT-derived `kpostID` (`KatchupControllerV2.java:158`), never client-supplied input. Confirmed both signup paths (`SignUpLoginControllerV2.java` and `SignUpLoginForMediumAndLargeController.java`, both using the same `User` entity) enforce `@Pattern(regexp = "^[A-Za-z][A-Za-z0-9_]*@.+$")` on kpostID at account creation — the local part can never contain a quote or any JPQL-breaking character. No reachable path to inject through this. Worth a defense-in-depth cleanup note to the developer, not a live finding.
- **At least 9 unscoped native/derived queries** return full row data (including message content) for an arbitrary ID with no sender/receiver/group filter in the SQL itself: `findBySharedMessageId`, `getdetailsDeleteKatchupMessage`, `updateDeletedBySender/Receiver`, `getSharedMessageId`, `getReferemessageDetails`, `getKatchupMsgByMsgID`, `findMessageTimeByMsgID`, `getMessageByMessageTime`, `findAllByMsgID`, plus `KatchupAttachmentRepository.findByUuid`/`getFileNameAndSizeUsingUuids`. Two purpose-built mitigation queries exist (`countAccessibleMessages`, `countAccessibleMessagesByAttachmentUuid`) — whether every caller of the unscoped queries actually invokes the matching guard needs per-endpoint live verification (the service-layer report above already maps which endpoints do/don't).
- **DTO validation is thin**: across 5 request DTOs, only 2 `javax.validation` annotations exist total. Numeric IDs are primitive (`long`) in some DTOs and boxed (`Long`) in sibling DTOs for the "same" concept — missing-vs-zero ambiguity is a real, recurring bug source.
- **`@Size(max=119)` on `referenceMessageIDList` has a message text bug** claiming the max is 120 — boundary-test at exactly 119/120 to confirm which is truly enforced.
- Recent (26-Sep through 01-Oct-2026) hardening pass converted ~30+ methods from "swallow exception → return null/empty" to "log and rethrow" — **any existing assumption of old soft-failure behavior should be re-verified live, not assumed stale or current.**

---

## 4. PRIORITY findings — recommend live-verifying and filing these first

Ranked by severity × confidence (all have exact source citations in the full agent reports, available in this session's history):

1. **`downloadAttachment`/`downloadThumbnail` require zero authentication** (`permitAll()` in Spring Security config) — already confirmed live today via `katchup-attachment-idor.spec.ts`. File if not already covered by an existing ticket.
2. ~~**Group message recall has no sender verification**~~ — **LIVE-TESTED 2026-10-03, NOT REPRODUCIBLE.** Fresh group, fresh message, immediate recall: A (sender) recalling their own message → `200 "Message recalled successfully"`. B (non-sender member) recalling A's message → `400 "Group message recall failed! Group message opened by any of the member"`. The backend does enforce a sender/ownership check — the error text is just confusingly worded (talks about "opened by member" rather than "not your message"). No BOLA here; closing this finding without filing.
3. **1:1 recall allows the receiver to recall a message sent to them** — likely an unintended business rule (should probably be sender-only). Needs a live test + a product decision on intended behavior.
4. ~~**V1 `group/removeGroupMember` — zero auth, hard delete, still live.**~~ **LIVE-TESTED AND FILED 2026-10-03 as #956 (CRITICAL/Highest).** Confirmed exactly as predicted: a completely uninvolved account (never a member, never an admin) removed a real member from a disposable throwaway group via the V1 legacy route (`/group/removeGroupMember/`, no `v2` prefix) — the same BOLA class as #507/KPV2-GRPBOLA, but on a sibling endpoint the 2026-10-01 V2 fix never touched. DB-verified: the member's row was hard-deleted (not soft `removed_flag`, an actual `DELETE`). Not a duplicate of #507/#623 — those are closed/fixed and specific to the `/v2/group/removeGroupMember/` route.
5. ~~**`getBulkMessageInfo`**~~ **ALREADY FILED as #953 earlier 2026-10-03.** Developer marked it RESOLVED FIXED at 09:47 UTC with no comment; live re-verification immediately after (same accounts, same sharedMessageId pattern) showed it reproduces byte-for-byte identically — reopened as CONFIRMED with the replay evidence.
6. **Reference-message family — fully resolved 2026-10-03**:
   - `getMessagesByReferenceMessageList` — confirmed live, genuinely unpatched (no filter exists in source at all). **Filed as #957.**
   - `getReferenceMessagesDetails` — confirmed live, also genuinely unpatched, a separate method from its similarly-named sibling. **Filed as #958.**
   - `getReferenceMSGDetails` (#954) — already has a correct participant filter in source (tagged `KPV2-REFDETAILSIDOR`); live re-test still leaked, most likely a deploy lag rather than no fix — re-test after confirming a deploy.
   - `forwardMessageBacktrackByMsgID` — confirmed earlier this session: correctly blocks with 403. Not a bug.
7. ~~**`getReadStatusGroupMessage`**~~ **CHECKED 2026-10-03, no action needed.** Same V1/V2 split as #956: the V2 route (`/v2/katchup/getReadStatusGroupMessage/`, used by the bench's own `katchup-read-status-group`) was already hardened server-side on 2026-09-26 with an exact-match membership check (`kpostID.equalsIgnoreCase(groupReadStatus.getReceiver())`, else 403). The vulnerable V1 sibling (`KatchupController.java`, no membership check at all) exists server-side but — confirmed via a full frontend search — is never called by the deployed web client (only `PostGroupMemberMessage` in `Katchup.js` calls this feature, and it's hardcoded to the `/v2` base). Not pursued further for the same reason as #956.
8. ~~**`getKatchupMessagesSubject`/`searchKatchUpMessageSubject`**~~ **DISPROVEN 2026-10-03, no live test needed.** Checked the actual SQL for both: `getKatchupMessagesSubject` is `UNION` of `(sender=me AND receiver=X) OR (receiver=me AND sender=X)`; `searchKatchUpMessageSubject`'s controller hard-overwrites `sender` with the authenticated caller's own id before the query runs (`fetchKatchupRO.setSender((String) request.getAttribute("kpostID"))`, `KatchupControllerV2.java:2346`), and its WHERE clause is `sender=:sender AND receiver=:receiver`. Neither can return another pair's conversation — naming an arbitrary contact you've never messaged just returns empty. (Minor unrelated functional note, not security: `searchKatchUpMessageSubject`'s WHERE is one-directional, sender=me only — it won't find subjects in messages the named contact sent TO you, unlike `getKatchupMessagesSubject`'s bidirectional UNION. Not pursued as its own ticket.)
9. ~~**Removed/left group members retain full read access to message history.**~~ **FILED as #959, then CLOSED INVALID after developer clarification — working as intended.** Live-tested: B left a disposable group, then immediately called the conversation endpoint — still showed every message sent while B was a member, correctly did not show a message sent after leaving. Developer clarified the actual product requirement: KPost message history is intentionally account-scoped and device-independent — a user keeps access to anything they legitimately received, from any device, forever (unlike WhatsApp's device-local-cache model, which was the (incorrect) comparison initially used to frame this finding). Once a message is legitimately delivered to an account, it stays part of that account's own history; being later removed from a group only stops *new* messages, which matches what was observed. Correctly closed as not a defect.
10. ~~**`saveKatchupMessages`**~~ **CHECKED 2026-10-03, no action needed.** Confirmed via source: the real UI feature ("multi-select messages → Save", which explicitly warns "the remaining N messages will be deleted") always calls the v2 route, which was already hardened 2026-09-26 to reject a null/empty `msgIDs` with 400 "msgIDs is required" before the destructive query runs. The unguarded V1 sibling (`KatchupController.java`, no guard at all) exists server-side but is confirmed dead code from the frontend's perspective — third time this exact V1/V2-split-plus-dead-V1 pattern has held (see also #956, #7). No live test needed or run, since the only reachable path is already safe.
11. ~~**`changeCaption`**~~ **CHECKED 2026-10-03, no action needed.** No V1/V2 split this time — only one implementation (`KatchupControllerV2.java:1577`), and it genuinely has zero ownership check (`katchupRepo.getById(messageId)` with no caller-identity filter, then a write — more severe than the read-only IDORs, since it mutates the message's `referenceMessage` field). Confirmed via a full frontend search that nothing in the web client calls this endpoint at all (not even commented out) — it's unreachable from the real product's web UI. Not pursued further per the same reachability-first policy as #956/#7/#10.
12. ~~**`getAllReportMsg`**~~ **CHECKED 2026-10-03, no action needed.** No V1/V2 split; genuinely zero role check (`katchupDao.getAllReportMSg()` — unfiltered). Confirmed via source and a frontend search of BOTH the main web app and the separate Admin_Module repo that nothing calls this endpoint anywhere — no report-listing/moderation screen exists in either codebase. Unreachable from any known first-party client; not pursued further.
13. **JPQL injection probe** on `getUnopenedMessagesCount`.
14. ~~**Group profile image downloads**~~ **CONFIRMED and FILED as #960 (HIGH).** Both `downloadGroupProfileImage` and `downloadGroupFullProfileImage` are in Spring Security's `permitAll()` list — not just "no membership check" but zero authentication at all. Live-confirmed: a completely anonymous request (no Authorization header) successfully downloaded a real uploaded group image (200, image/jpeg, real bytes).
15. ~~**`getGroupDetailsUsingGroupKpostID`**~~ **CONFIRMED and FILED as #961 (CRITICAL) — worse than hypothesized.** Not a subtle contact-relationship edge case: the "known"/"unknown" branches are mutually exclusive and collectively exhaustive, and BOTH return the full group record on a match — the response key name is cosmetic, there is no actual access-control decision anywhere in the code path. Live-confirmed: an unrelated, non-member, non-contact account fetched a PRIVATE group's full record, including its bcrypt `passCode` hash and complete member roster, by groupKpostID alone.

**Separately — not a test-coverage item, flagging for the record**: `FireBaseServiceImpl.java` hardcodes the Firebase service account's RSA private key directly in source. This needs remediation attention, not a test case.

---

## 5. Frontend architecture ground truth

- Live router: `/katchup` → `Katchup.js`. Left panel (Recents/Contacts) and DigitalCard are **single-sourced** regardless of chat skin. Only the open-thread/composer is skin-swapped (`bubble/` default, `classic/` via `localStorage["katchup_chat_variant_v1"]`).
- **Dead code — do not write tests against these**: `bubble/Katchup.js` + `classic/Katchup.js` top-level pages and their entire private subtrees (`KKatch`, `Recent`, `RecentMessage`, `Contact`, `ContactList`, `UnOpenedMessage`, `AdvancedSearch`, `FrequentlyAccessed` — all duplicated under bubble/classic but unreachable); `ProfilePage.js` (imported but never rendered); `Map.js`; `Messagewithcopies.js`; `Block/Delete/ReportContact.js` under the `components/` left-panel tree (only the `bubble/` copies, reached via Digital Card, are live); `Diary.js` (fully built, API-backed, but commented out of its parent — a lot of invisible working functionality); `Widgets.js` (static, no onClick at all); `KOS/apps.js`.
- **Confirmed non-functional UI features that look real but aren't — ALL VERIFIED AND FILED 2026-10-03**:
  - **Report Contact** — confirmed by reading the full `confirmbutton()` handler: it only calls `onclosebutton()`, zero network calls anywhere in the file. **Filed as #966.**
  - **Left-panel "Advanced Search"** (`components/AdvancedSearch/AdvancedSearch.js`, the live single-sourced tree, reached via `Contact.js`) — confirmed zero fetch/axios/service calls across all 307 lines. **Filed as #969.** (The in-thread `KatchupMessage.js` variant and the bubble/classic duplicates were not independently re-verified — same class of issue, lower priority since the left-panel one is now tracked.)
- **Real bugs found by reading the UI code — VERIFIED AND FILED 2026-10-03**:
  - `DigitalCard.js`'s `handleBlock` — confirmed the failure branch (`response.status !== "SUCCESS"`) calls `toast.success()` instead of an error toast, and skips the local-state update, so a failed block/unblock looks successful to the user. **Filed as #968.**
  - Group creation (`ContactList.js` `handleCreateGroup`) — confirmed it validates ONLY `grpName.trim()`, never `grpMember.length`; a group with zero additional members (creator only) can be created. **Filed as #967.** Also confirmed a live `debugger;` statement at the top of this exact handler (noted in the same ticket).
  - Whitespace-only group name passes the "Add Members" gate (`grpName` raw-string check) but fails the "Create" gate (`grpName.trim()` check) — confirmed at the exact two line numbers. **Checked but NOT filed** — gatekeeper correctly rejected it as below the filing severity floor (LOW/MINOR); noted here for the record only.
  - The live group-creation socket listener — **confirmed and filed as #970**: `ContactList.js`'s `handleReceiveGrp` handler is fully built and correct, but the actual subscription call (`receiveaddGroupCreate(handleReceiveGrp)`) is commented out at the exact line, so a newly-added member never sees the group appear without a manual reload.
  - Found 2 of the claimed 5 `debugger;` statements directly (not the same 2 originally named — `ContactList.js` `handleCreateGroup` line 781, folded into #967; `WriteMessage.js` `handleSelectedFile` line 570, not yet filed separately) — the other 3 from the original list not independently re-verified this pass.
  - `mediaSteam`/`ImagemediaSteam` in `Services/Katchup.js` have a 100%-reproducible `TypeError` bug — currently dead/unreachable code, but flag if anything ever re-wires it.
  - No DOMPurify sanitization on inbound message rendering (`LazyEditor.js`) — mitigated by Quill's own link sanitizer, but no defense-in-depth if the backend is ever hit directly.
- **19 confirmed functional differences between the `classic` and `bubble` chat skins** (not styling — see the full agent report for file:line detail on each): voice-message record/preview/discard flow, @mention autocomplete (bubble-only, dead code in classic), auto-capitalization (classic-only), edited-message diff highlighting (bubble-only), KAD/PDF/Word document rendering (bubble-only), voice-attachment detection heuristic, "Unopened Messages" divider (bubble-only), chat theme/wallpaper customization (bubble-only), message virtualization (bubble-only, performance-relevant), forward message/recipient caps (5 msg/10 recipients bubble vs. 10 msg/uncapped recipients classic), **classic's "Hide Source" toggle has no effect on bulk forwards (real classic-only bug)**, copy-restriction removed in bubble, MultipleContact selection caps and business-contact display differ, read-receipt status-comparison robustness, reference-message pagination/dedup (classic has none), business-badge detection reliability, reference-message read-more clamp + voice playback (bubble-only), reply-icon visibility on blocked messages, single-chat-expand (bubble-only by construction). **Since bubble is the default for virtually every user, prioritize bubble coverage, but classic-specific bugs are still real and reachable** (anyone can flip the localStorage flag).

---

## 6. Recommended coverage-gap table (what Section 2 of a full production-grade closeout would look like)

| Category | Backend gaps found | Frontend gaps found |
|---|---|---|
| **Functional** | `saveKatchupMessages` empty-list guard; secret-message expiry write path unconfirmed; recall business-rule ambiguity (1:1 receiver-recall) | Report Contact stub; Advanced Search (both) non-functional; group-creation socket listener dead |
| **Validation/Negative** | Thin DTO validation (2 annotations total); `@Size` message-text bug; primitive-vs-boxed ID inconsistency | Group-name whitespace gate mismatch; file-upload no accept/size cap client-side |
| **Auth/Authz** | V1 removeGroupMember (critical); group recall (critical); getBulkMessageInfo; reference-message family; getReadStatusGroupMessage; getKatchupMessagesSubject/searchSubject; changeCaption; getAllReportMsg; group image downloads; getGroupDetailsUsingGroupKpostID | Block/Report/Delete-contact UI only reachable via Digital Card, not from the thread itself (functional gap, not security) |
| **Security/IDOR** | downloadAttachment/downloadThumbnail (critical, confirmed); 9 unscoped DB queries; JPQL injection in getUnopenedMessagesCount | No DOMPurify on message render (defense-in-depth gap) |
| **Database** | No FK integrity anywhere in Katchup tables; soft-delete-only with no S3 cleanup; `GroupReadStatus` never cleaned on member removal | N/A |
| **Performance** | `captionChange`'s synchronous `Thread.sleep(500)` per item, unbounded by list size; `forwardKatchupMultipleMsgs`'s fire-and-forget async with no completion signal to client | Message virtualization only in bubble (classic renders everything — perf-testable directly) |
| **UI Functional** | N/A | 19 classic-vs-bubble differences (§5); secret/confidential message UI (real, untested); forward caps; group admin menu (no keyboard access) |
| **E2E** | Full send→recall→fetch (already covered, `lifecycle.spec.ts`); send→forward→fetch-by-recipient (already covered, `shared-reference-workflow.spec.ts`); group-create→add→remove→fetch-as-removed-member — **done, turned out to be correct behavior, see #959 closure** | ~~Compose→attach→send→thread-render~~ **DONE 2026-10-03**: new permanent test `tests/e2e/katchup-attach-send-e2e.spec.ts`, 2 clean live runs. ~~group-create→add-member→see-in-real-time (currently broken)~~ **confirmed and filed as #970.** |
| **Accessibility** | N/A | Near-total gap: 2 `aria-label`s across 13,665 lines of KatchupMessage.js; WriteMessage.js/ForwardFooter.js = 0; group-admin menu items have no role/tabIndex/keyboard handler |
| **Error/Boundary** | Inconsistent HTTP-status conventions (200/404 for "no results" varies by sibling endpoint); V1 Group endpoints never differentiate HTTP status at all | Several silent-failure UI patterns (CopiesMessageView, BulkMessageInfoView, handleInviteStatus, FrequentlyAccessed load, StarMessage with no try/catch) |

---

## Appendix: bench baseline captured before this research (2026-10-03)

- 32 Katchup + 12 Group endpoint definitions in `src/api/definitions/kpost/katchup/` and `.../group/`.
- ~58 named API tests across 16 spec files (several more via generic `describeEndpointCases` sweeps with no individual test count).
- 29 named UI tests across 14 spec files (`katchup*.spec.ts`, `group*.spec.ts`).
- Today's live findings already folded in above: `katchup-attachment-idor.spec.ts` (5 leaking routes, 1 inconclusive), `#945` (removeGroupMember malformed-input 500, partially reconfirmed), the `searchKatchUpMessage` hang (not filed per the bench's own anti-flake gate), `katchup-messages-subject` path-param fix.
