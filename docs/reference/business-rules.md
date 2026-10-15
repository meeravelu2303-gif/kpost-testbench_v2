# Business rules — the catalog the bench tests against

The product's **logic** rules (the "system MUST behave this way" statements), extracted from the six
per-module FRDs + BRD/SRS/PRD/FSD in `D:\Kpost Documents`. This is the source of truth for the
business-rule layer, the way the Excel workbook is for the API contract.

**How a rule is tested.** Each rule names the endpoint/action it constrains and _how_ to verify it —
the concrete check against the **response or state**, never just "the call was accepted." A confirmed
violation on live is filed via `endpoints.recordBusinessRuleViolation(...)` → the same safe pipeline as
any finding (product-scoped dedupe, validity gate, routed to the module developer). Response shapes are
**measured from one gated live run per module** before the assertion is written — no guessed field ever
files a false bug.

**Status legend:** ✅ verified against the response · 🟡 partial (only "accepted", or UI-only) · ⬜ to
do · ⛔ out of scope (OTP-gated signup / mobile-only device features). Guard:
`tests/framework/business-rules-coverage.spec.ts` fails if a rule here is unmapped.

---

## Signup & Login (`kpost-api`)

| Rule                                                                             | Applies to                | Verify                                                       | Status | Spec               |
| -------------------------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------- | ------ | ------------------ |
| **BR-SL-UNIQUE** — an already-registered KPost ID is rejected / reported taken   | `kpostIdExist`, signup    | an existing id → not-available; a free id → available       | ✅     | `common/*`         |
| **BR-SL-ENUM** — a wrong password and an unknown id answer identically           | `userLogin`               | same status + message for both                              | ✅     | `login-flow.spec`  |
| **BR-SL-ACTIVATE** — login before activation must fail (SRS-S03)                 | `userLogin`               | login on a not-activated account is refused                 | ⛔ (N/A by design) | Investigated live 2026-10-03, now that signup is back in scope: `TBL_KPOST_USER_MASTER.active_status` is already `"yes"` the instant the signup call succeeds — the two-OTP gate (mobile + mail) IS the activation step, and there is no intermediate "created but inactive" state reachable through normal signup to test "login before activation" against. `active_status='no'` exists as a column (used for deactivation elsewhere, e.g. the profile endpoints), but reaching it would mean deliberately deactivating a real account first — not attempted without a dedicated spare account and explicit sign-off, same reasoning as the forgot-password spare-account policy. |
| **BR-SL-JWT** — successful login issues a signed JWT; protected calls need it    | `userLogin`, all authed   | token present + signed; no/invalid token → rejected         | ✅     | engine auth        |
| **BR-SL-LOGOUT** — logout invalidates the session token (SRS-S05)                | `userLogout`              | post-logout the token no longer authenticates               | ✅     | `login-flow.spec` — confirmed live 2026-10-03: a token used again after its own logout is refused 401 by `getActiveSession`, not just a missing DB row |
| **BR-SL-PWD** — password ≥8 with upper/lower/digit/special (NFR-SEC03)           | signup                    | a password missing a class is rejected                      | ✅     | `otp-signup-lifecycle.spec` — confirmed live 2026-10-03: all 6 variants (too-short, missing each of the 4 classes) rejected 400 with an explicit password-specific message, even against an already-registered identity (password validation runs before the duplicate check) |
| **BR-SL-3IDS** — mobile number or the full domain-qualified KPost ID log in; the bare (no-domain) KPost ID is correctly rejected | `userLogin`               | mobile → 200 (correct account); full domain-qualified ID → 200 (correct account); bare KPost ID (no domain) → 401, by design | ✅     | `login-flow` — the FRD text this rule was originally transcribed from reads as if a bare KPost ID were a third valid identifier; it is not. Developer confirmed 2026-10-03 (bug #949, closed INVALID): the local part of a KPost ID (before the `@`) is not unique across domains — the same username can exist under different domains as different accounts — so a bare ID is genuinely ambiguous and login correctly requires either the mobile number or the full, domain-qualified ID. Corrected here after the bench had filed the old (wrong) reading of the rule as a defect. |

## Katchup (`kpost-api`)

| Rule                                                                                       | Applies to                  | Verify                                                        | Status | Spec                 |
| ------------------------------------------------------------------------------------------ | --------------------------- | ------------------------------------------------------------ | ------ | -------------------- |
| **BR-KU-SUBJECT** — a message always carries a Subject (blank → "General")                 | `sendMessage`               | sent message persists the Subject; blank stored as "General" | ✅     | `katchup/feature`    |
| **NFR-SEC02** — a Confidential Copy recipient is hidden from other recipients              | `sendMessage` (copies)      | other recipients' view omits the confidential recipient      | ✅     | `katchup/feature`    |
| **BR-KU-EDIT-SUBJ** — edit changes the BODY only; Subject cannot change; "Edited:" marker  | `editMessage`               | after edit: Subject unchanged, body changed, marker present  | 🟡     | **2026-10-04: subject-immutability tested, confirmed server-side gap (defense-in-depth only, not user-facing).** The server accepts and persists a changed Subject on `editMessage` with no guard at all. The real UI client is NOT exposed to this — `WriteMessage.js` disables the Subject input (`isDisabled={isEdited \|\| isEditedandRepost}`) during edit, so no real user can trigger it. Recorded via `recordBusinessRuleViolation` (BR-KU-EDIT-SUBJ) in `katchup/feature` rather than filed as a Bugzilla ticket — matches the established bar for a server-only gap unreachable from the real product. |
| **BR-KU-RECALL** — recall removes the message from the recipient's view                    | `recallMessage`             | recalled message absent from recipient read-back             | ✅     | `katchup/feature`    |
| **BR-KU-RECALL-UNREAD** — recall is allowed ONLY before the recipient has read it          | `recallMessage`             | recall on an already-read message is blocked                 | ✅     | `katchup/feature` (verified live 2026-10-02) |
| **BR-KU-RECALL-SCOPE** — recall is unavailable for copies and group messages (group half only) | `recallMessage`             | recall on a copy/group message is refused                    | ✅     | `katchup/feature` (group half verified live 2026-10-02; the copies half is not yet covered) |
| **BR-KU-DISAPPEAR-READ** — "Disappear After Reading" deletes on the recipient's read       | `sendMessage` (isVanished)  | after recipient reads, message gone; no timer                | 🟡     | **Confirmed broken 2026-10-03, filed as #976.** `isVanished` is accepted, stored, and echoed back (`katchup/feature`'s existing assertion — the 🟡-worthy part), but is never read anywhere outside its own entity getter/setter — zero references in `KatchupServiceImpl.java` or any repository. There is no code path that could delete the message on read. |
| **BR-KU-DISAPPEAR-SCHED** — "Disappear As Per Schedule" deletes at the timer regardless    | `sendMessage` (expireTime)  | message removed at scheduled time even if unread             | 🟡     | **Confirmed broken 2026-10-03, filed as #976** (same finding — `secretMessageExpireTime` has the identical zero-implementation pattern). Also confirmed no scheduled job exists anywhere in the backend that could sweep expired messages: `grep -rln "@Scheduled"` across the whole app returns exactly one match, `RepeatKallMaterializerJob` (Kall recurrence, unrelated to Katchup). |
| **BR-KU-DISAPPEAR-IMMUTABLE** — the disappear flag cannot change after send                | sent message                | no edit path alters the flag post-send                       | ⬜     | Secondary to the above — the flag's mutability post-send matters far less while the flag has no effect at all. Still genuinely to-do, now lower priority. |
| **BR-KU-FORWARD-HIDE** — hide-source forward does not expose the original sender           | `forwardKatchupMultipleMsgs` (bulk forward) | hidden-source forward omits the original sender identity (server anonymizes via `messageType: 16`) | 🟡     | Verified via source 2026-10-03: bubble (the default theme) correctly honors the toggle, sending `messageType: 16` (anonymized sender) when "Hide Source" is selected. Classic hard-codes `messageType: 15` (real sender always revealed) regardless of the toggle — filed as **#972**. The underlying `messageType: 15` vs `16` receiver-count cap asymmetry was separately filed as **#971**. |
| **BR-KU-RECEIPTS** — per-recipient read date/time recorded (SRS-K03 / BR-X01)              | group send + receipts read  | a member shows a read timestamp only after reading           | ✅     | **2026-10-04: strengthened from a shallow 200-status check to a real per-recipient assertion.** After a 3-member group send, member B opens the conversation (marks it read for B only); the receipts read-back then confirms B shows read while C and D — who never opened it — do not. `katchup/feature` |
| **BR-KU-DELETE-OWN** — deleting a received message removes it from the deleter's view only  | `deleteMessage`             | removed for the deleter; still present for others            | ✅     | `katchup/feature` (verified live 2026-10-02) |

## Katchup — Group (`kpost-api`)

| Rule                                                                            | Applies to        | Verify                                                    | Status | Spec              |
| ------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------- | ------ | ----------------- |
| **FR-GC-006** — a group must be created with more than one person: the creator AND at least one member (confirmed by Meera 2026-10-15) | `createUserGroup` | create with no other members is rejected                 | ✅ (finding) | `group/feature` — **VIOLATED live 2/2 (2026-10-15):** createUserGroup accepts a creator-only group (200), which then cannot be deleted (400 "invalid Parameters") — **#1369**. The web app enforces the rule (no Create without a member). The test cleans up by adding+removing a member first |
| **FR-GM-010** — adding a member increments the member count                     | `addGroupMember`  | count +1 after add; member listed                        | ✅ | `group/feature` — **2026-10-15:** the active-member count goes up by exactly one and the added member is listed (group-details read-back), API 2/2 green |
| **FR-GM-011** — removing a member decrements the count; user no longer listed   | `removeGroupMember` | count −1; removed user absent                          | ✅ | `group/feature` — **2026-10-15:** after removeGroupMember the active-member count drops by exactly one and the removed member is flagged `removedFlag:true` (no longer active), API 2/2 green (#945 fixed) |
| **FR-GM-012** — Add Admin promotes a member; both admins then listed            | `addOrRemoveAdminAccess` | promoted member appears as admin                    | ✅ | `group/feature` — promote → the member's `admin_access` is `Y` in the database; API 2/2 green 2026-10-15 |
| **FR-GM-013** — Remove Admin allowed only when >1 admin exists                  | `addOrRemoveAdminAccess` | demotion blocked when sole admin                    | ✅     | `group/feature` (verified live 2026-10-02; note: an earlier test in the same file mislabeled a different, 2-admin demote scenario as "FR-GM-013" — that naming mismatch is unresolved, see the test bench's own plan doc) |
| **FR-GM-014** — an admin (creator or promoted co-admin — same rights) cannot exit; admins remove members, only a member exits (owner rule, Meera 2026-10-15) | `leaveFromGroup`  | any admin's exit is refused; a member's exit works | ✅ (finding) | `group/feature` — creator-exit and co-admin-exit asserted (each group keeps a second admin, so nothing is orphaned). **VIOLATED 4/4 on 2026-10-15:** both answer 200 and the leaver is gone — **#1366** (KPost API) and **#1367** (KPost UI: the app offers Exit Group to a co-admin). The sole-admin exit (also 200 → zero-admin group 5214) is opt-in `GROUP_SOLE_ADMIN_EXIT=true`. The earlier sole-admin check was vacuous (exited with id '0') |
| **FR-GC-delete** — a group cannot be deleted until all members are removed      | `deleteGroup`     | delete with members present → 400 "remove all members"   | ✅     | `katchup/feature` |

## Kall (`kpost-api`)

| Rule                                                                                    | Applies to              | Verify                                                       | Status | Spec           |
| --------------------------------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------- | ------ | -------------- |
| **BR-C01 / FR-KL-003** — reschedule KEEPS the same kallID (no new call); status → Rescheduled | `reScheduleKall`  | response kallID == original; single dashboard entry; status 7 | ✅ (files) | `kall/feature` |
| **FR-KL-001** — a scheduled Kall requires title + date + start/end; missing → blocked   | `scheduledKall`         | save rejected when a required field is missing              | ✅ | `kall/feature` — **now ENFORCED, re-verified live 2026-10-15 (2/2):** a payload missing `subject`, `scheduledStartTime` or `scheduledEndTime` is each rejected (≥400), while the complete payload is accepted (control: the FR-KL-002 test). The 2026-10-02 violation was fixed with #1314/#1315 |
| **FR-KL-002** — added participants are recorded as invitees                             | `modifyKallMembers`     | added participant present in the call's member read-back     | ✅ | `kall/feature` — **2026-10-15 (2/2):** the scheduled call keeps the exact title, start and end it was sent, records its invitee, and a member added with modifyKallMembers is recorded too (API read-back + one `TBL_KPOST_KOOL_KALL_DETAILS` row per invitee) |
| **FR-KL-008** — the call log records participants, role/team, duration (participant half only) | `kallDashboard`/log     | a completed call yields a log entry with those fields        | ✅     | `kall/feature` (verified live 2026-10-02; the duration half is covered by FR-KL-009's limitation below) |
| **FR-KL-009** — the log records exact start and end timestamps                          | call log                | log entry has precise start + end timestamps                 | ⬜ (untestable here) | **Not independently testable by this bench**: measured live 2026-10-02 — `kallStartTime`/`kallEndTime`/`kallDuration` stay `null` through a full initiate→end cycle because no real WebRTC peer ever connects (a documented, structural constraint of this bench, not a product defect assumed). Would need a real two-party connected call to verify meaningfully. |

## KMail (`kmail-api`)

| Rule                                                                                     | Applies to        | Verify                                                    | Status | Spec           |
| ---------------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------- | ------ | -------------- |
| **FR-KM-005** — the To: field accepts only ONE recipient; extras go to Cc               | `postMail`        | a second To recipient is rejected                        | ✅ (finding) | `kmail/feature` — **hard-asserted 2026-10-15:** one To + Cc is accepted, and a To with TWO addresses must be refused. **VIOLATED live 3/3:** a comma/semicolon-separated To answers 200 "SUCCESS" but `mailDeliveryStatus` FAILURE and nobody receives it — **#1365** (KMail API, Jitendra). A JSON-array To is correctly 400 |
| **BR-M01 / SRS-M02** — per-mail read receipt with exact open date/time                  | mail read-receipt | after recipient opens, a read timestamp appears; else none | ✅ (finding) | UI `kmail-read-receipt-e2e` (new 2026-10-15) — before B opens: A sees readStatus N, no read time, getCopiesInfo readTime null (asserted); after B opens in the browser A must see readStatus Y + a read time inside the send→now window. **VIOLATED 3/3:** B's open returns an empty record (kmailID 0, #1348) and the mail stays unread for A — **#1359** (commented 2026-10-15 with screenshot) |
| **FR-KM-010/011** — priority Low/Medium/High (default Low); High is the distinct flag    | `postMail`        | high-priority mail carries its priority flag             | ✅ | `kmail/mail-semantics-workflow` — **2026-10-15 (2/2 each):** a High mail arrives as High, and a mail sent with the composer's default (Low, 0) arrives as Low without the High flag |
| **BR-KM-SALUTE** — salutation is one of {Hi,Hello,Dear,Sir,Madam,Respect}, default Hi   | `postMail`        | an out-of-set salutation is rejected/normalized          | ✅     | `kmail/feature` (verified live 2026-10-02, post-auth-fix) |
| **BR-KM-BODY** — send requires body text                                                 | `postMail`        | empty-body send is rejected                              | ✅     | `kmail/feature` (verified live 2026-10-02, post-auth-fix) |
| **BR-KM-EXTERNAL** — a non-KPost email is accepted as a recipient                        | `postMail`        | an external address is accepted                          | ✅     | `kmail/feature` (verified live 2026-10-02, post-auth-fix) |

## KDirectory (`kpost-api` + `ui`)

| Rule                                                                        | Applies to                    | Verify                                            | Status | Spec        |
| --------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------ | ------ | ----------- |
| **FR-KD-002 org-scope** — directory shows only the viewer's own org users   | `globalSearch`/directory      | users outside the viewer's org are absent         | ⬜     | to-do       |
| **FR-KD-002 search** — search by name; no match → empty state               | `globalSearch`                | query returns only name-matching entries          | 🟡     | contacts    |
| **FR-KD-003** — each entry shows name, role/designation, team               | directory entry               | all three fields present                          | ✅ (finding) | UI `kdirectory-launch` — rows compared with the globalSearch reply; **VIOLATED 3/3 (2026-10-15): no name on any row — #1370** |
| **FR-KD-005** — opening an entry returns that user's full profile           | `getUserProfileUsingKpostID`  | profile view returns the selected user's details  | ✅     | profile read · UI `kdirectory-launch`: the Digital Card shows the entry's name, email and location (2/2 2026-10-15) |

## Admin / HR-Setup (`admin-api`)

| Rule                                                                        | Applies to                 | Verify                                             | Status | Spec           |
| --------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------- | ------ | -------------- |
| **BR-ADM-TIER-ORDER** — the org build is ordered (tier→variable→location…)  | admin write lifecycle      | each step's id feeds the next; read-back confirms | ✅     | `admin/feature`|
| **BR-ADM-500-VALIDATION** — a missing required field → 400, not a 500 NPE   | `employeeDetails/save`     | missing `employmentObj` → 4xx (currently 500)     | ✅ (finding) | `admin/feature`|

---

### Cross-cutting (all modules)

- **NFR-SEC01** — every authenticated operation requires a valid JWT → covered by the engine's auth validators on every endpoint.
- **NFR-SEC02** — Katchup confidential copy invisibility → `katchup/feature` (above).
- **BR-X01** — read receipts behave identically in Katchup and KMail → verify both record a per-recipient open date/time.
