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
| **BR-SL-ACTIVATE** — login before activation must fail (SRS-S03)                 | `userLogin`               | login on a not-activated account is refused                 | ⛔     | signup out-of-scope|
| **BR-SL-JWT** — successful login issues a signed JWT; protected calls need it    | `userLogin`, all authed   | token present + signed; no/invalid token → rejected         | ✅     | engine auth        |
| **BR-SL-LOGOUT** — logout invalidates the session token (SRS-S05)                | `userLogout`              | post-logout the token no longer authenticates               | 🟡     | `login-flow.spec`  |
| **BR-SL-PWD** — password ≥8 with upper/lower/digit/special (NFR-SEC03)           | signup                    | a password missing a class is rejected                      | ⛔     | OTP-gated          |
| **BR-SL-3IDS** — mobile, KPost ID, and full KPost-ID-with-domain all log in      | `userLogin`               | each of the three forms authenticates the same account      | ⬜     | to-do              |

## Katchup (`kpost-api`)

| Rule                                                                                       | Applies to                  | Verify                                                        | Status | Spec                 |
| ------------------------------------------------------------------------------------------ | --------------------------- | ------------------------------------------------------------ | ------ | -------------------- |
| **BR-KU-SUBJECT** — a message always carries a Subject (blank → "General")                 | `sendMessage`               | sent message persists the Subject; blank stored as "General" | ✅     | `katchup/feature`    |
| **NFR-SEC02** — a Confidential Copy recipient is hidden from other recipients              | `sendMessage` (copies)      | other recipients' view omits the confidential recipient      | ✅     | `katchup/feature`    |
| **BR-KU-EDIT-SUBJ** — edit changes the BODY only; Subject cannot change; "Edited:" marker  | `editMessage`               | after edit: Subject unchanged, body changed, marker present  | 🟡→⬜ | body verified; subject-immutability to add |
| **BR-KU-RECALL** — recall removes the message from the recipient's view                    | `recallMessage`             | recalled message absent from recipient read-back             | ✅     | `katchup/feature`    |
| **BR-KU-RECALL-UNREAD** — recall is allowed ONLY before the recipient has read it          | `recallMessage`             | recall on an already-read message is blocked                 | ⬜     | to-do                |
| **BR-KU-RECALL-SCOPE** — recall is unavailable for copies and group messages               | `recallMessage`             | recall on a copy/group message is refused                    | ⬜     | to-do                |
| **BR-KU-DISAPPEAR-READ** — "Disappear After Reading" deletes on the recipient's read       | `sendMessage` (isVanished)  | after recipient reads, message gone; no timer                | 🟡     | `katchup/feature` (sends both modes; read-delete to verify) |
| **BR-KU-DISAPPEAR-SCHED** — "Disappear As Per Schedule" deletes at the timer regardless    | `sendMessage` (expireTime)  | message removed at scheduled time even if unread             | ⬜     | to-do                |
| **BR-KU-DISAPPEAR-IMMUTABLE** — the disappear flag cannot change after send                | sent message                | no edit path alters the flag post-send                       | ⬜     | to-do                |
| **BR-KU-FORWARD-HIDE** — hide-source forward does not expose the original sender           | `forwardKatchupMessage`     | hidden-source forward omits the original sender identity      | ⬜     | to-do (forwards 500 today) |
| **BR-KU-RECEIPTS** — per-recipient read date/time recorded (SRS-K03 / BR-X01)              | group send + receipts read  | a member shows a read timestamp only after reading           | 🟡     | `katchup/feature`    |
| **BR-KU-DELETE-OWN** — deleting a received message removes it from the deleter's view only  | `deleteMessage`             | removed for the deleter; still present for others            | ⬜     | to-do                |

## Katchup — Group (`kpost-api`)

| Rule                                                                            | Applies to        | Verify                                                    | Status | Spec              |
| ------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------- | ------ | ----------------- |
| **FR-GC-006** — a group needs ≥1 member besides the creator to be created       | `createUserGroup` | create with no other members is rejected                 | ⬜     | to-do             |
| **FR-GM-010** — adding a member increments the member count                     | `addGroupMember`  | count +1 after add; member listed                        | 🟡     | `group/feature`   |
| **FR-GM-011** — removing a member decrements the count; user no longer listed   | `removeGroupMember` | count −1; removed user absent                          | 🟡     | `group/feature`   |
| **FR-GM-012** — Add Admin promotes a member; both admins then listed            | `addOrRemoveAdminAccess` | promoted member appears as admin                    | 🟡     | `group/feature`   |
| **FR-GM-013** — Remove Admin allowed only when >1 admin exists                  | `addOrRemoveAdminAccess` | demotion blocked when sole admin                    | ⬜     | to-do             |
| **FR-GM-014** — a sole admin cannot exit until another admin exists             | `leaveFromGroup`  | sole admin's exit blocked; non-sole admin exits          | 🟡     | `group/feature` (2xx recorded as finding) |
| **FR-GC-delete** — a group cannot be deleted until all members are removed      | `deleteGroup`     | delete with members present → 400 "remove all members"   | ✅     | `katchup/feature` |

## Kall (`kpost-api`)

| Rule                                                                                    | Applies to              | Verify                                                       | Status | Spec           |
| --------------------------------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------- | ------ | -------------- |
| **BR-C01 / FR-KL-003** — reschedule KEEPS the same kallID (no new call); status → Rescheduled | `reScheduleKall`  | response kallID == original; single dashboard entry; status 7 | ✅ (files) | `kall/feature` |
| **FR-KL-001** — a scheduled Kall requires title + date + start/end; missing → blocked   | `scheduledKall`         | save rejected when a required field is missing              | ⬜     | to-do          |
| **FR-KL-002** — added participants are recorded as invitees                             | `modifyKallMembers`     | added participant present in the call's member read-back     | 🟡     | `kall/feature` |
| **FR-KL-008** — the call log records participants, role/team, duration                  | `kallDashboard`/log     | a completed call yields a log entry with those fields        | ⬜     | to-do          |
| **FR-KL-009** — the log records exact start and end timestamps                          | call log                | log entry has precise start + end timestamps                 | ⬜     | to-do          |

## KMail (`kmail-api`)

| Rule                                                                                     | Applies to        | Verify                                                    | Status | Spec           |
| ---------------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------- | ------ | -------------- |
| **FR-KM-005** — the To: field accepts only ONE recipient; extras go to Cc               | `postMail`        | a second To recipient is rejected                        | 🟡     | `kmail/feature`|
| **BR-M01 / SRS-M02** — per-mail read receipt with exact open date/time                  | mail read-receipt | after recipient opens, a read timestamp appears; else none | ⬜   | to-do          |
| **FR-KM-010/011** — priority Low/Medium/High (default Low); High is the distinct flag    | `postMail`        | high-priority mail carries its priority flag             | 🟡     | `kmail/feature`|
| **BR-KM-SALUTE** — salutation is one of {Hi,Hello,Dear,Sir,Madam,Respect}, default Hi   | `postMail`        | an out-of-set salutation is rejected/normalized          | ⬜     | to-do          |
| **BR-KM-BODY** — send requires body text                                                 | `postMail`        | empty-body send is rejected                              | ⬜     | to-do          |
| **BR-KM-EXTERNAL** — a non-KPost email is accepted as a recipient                        | `postMail`        | an external address is accepted                          | ⬜     | to-do          |

## KDirectory (`kpost-api` + `ui`)

| Rule                                                                        | Applies to                    | Verify                                            | Status | Spec        |
| --------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------ | ------ | ----------- |
| **FR-KD-002 org-scope** — directory shows only the viewer's own org users   | `globalSearch`/directory      | users outside the viewer's org are absent         | ⬜     | to-do       |
| **FR-KD-002 search** — search by name; no match → empty state               | `globalSearch`                | query returns only name-matching entries          | 🟡     | contacts    |
| **FR-KD-003** — each entry shows name, role/designation, team               | directory entry               | all three fields present                          | ⬜     | to-do       |
| **FR-KD-005** — opening an entry returns that user's full profile           | `getUserProfileUsingKpostID`  | profile view returns the selected user's details  | ✅     | profile read|

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
