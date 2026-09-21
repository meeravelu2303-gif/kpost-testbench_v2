# Business invariants — what the product must do, and how well we show it

**GENERATED — do not edit.** Written by `tests/framework/business-invariants.spec.ts`
(`npm run test:framework`) from `src/business-rules/invariants/`.

`docs/business-rules.md` remains the source narrative — where each rule comes from and why.
This is the measured view: the same rules, with the evidence each one actually has today.

**Status is not importance.** `VERIFIED` means a named spec asserts the rule against a
response or a read-back state; it does NOT mean the application obeys it. `BR-C01` is
VERIFIED and is believed to be violated on live — that is the point of the layer.

| | Count |
| - | ----: |
| Declared invariants | **46** |
| — VERIFIED (a spec asserts it) | 11 |
| — PARTIAL (something asserted, gap recorded) | 14 |
| — TO_DO | 18 |
| — OUT_OF_SCOPE (reason recorded) | 3 |
| Carrying an unresolved conflict | 6 |

## Unresolved conflicts

Preserved, never resolved by this layer.

| Rule | Conflict |
| ---- | -------- |
| `BR-SL-ACTIVATE` | BR-S01 requires activation; the documented API contains no activation endpoint. Preserved as a documentation/implementation conflict. |
| `BR-KU-RECEIPTS` | CONF-KATCHUP-READ-PERSPECTIVE: the Phase 4D calibration found the API conversation read itself performs the read transition, which contradicts the Phase 4B model recording the mechanism as UI. Preserved, not resolved. |
| `FR-GM-014` | Whether this rule is enforced server-side or only in the UI is unconfirmed. The FRD states the rule without naming the layer, and the one live observation recorded a 2xx. Asserting a refusal now could file a defect against a rule the API was never meant to enforce, so the finding is recorded and the question left open. |
| `BR-GC-DELETE-EMPTY` | No FRD states this. It may be intended behaviour or an API limitation; CLAUDE.md records it as "possibly a finding". Kept as OBSERVED so it is never cited as a documented requirement. |
| `BR-C01` | CONF-KALL-BR-C01: the FRD states identity is preserved; the owner reported a new kallID on live. The state catalogue carries the same conflict on `kall.rescheduled`. Not resolved here. |
| `BR-X01` | CONF-KATCHUP-READ-PERSPECTIVE applies here too: if the Katchup read transition is performed by the API read itself rather than by a UI action, the two modules may not be comparable on the same trigger at all. Preserved. |

## signup-login

| Rule | Statement | Actors | Evidence needed | Status | Spec / gap |
| ---- | --------- | ------ | --------------- | ------ | ---------- |
| `BR-SL-UNIQUE` | An already-registered KPost ID is reported as taken and cannot be registered again. | sender | RESPONSE_FIELD | VERIFIED | tests/api/kpost/signup-login/coverage.spec.ts + the common identity specs |
| `BR-SL-ENUM` | A wrong password and an unknown account answer identically, so login cannot be used to discover who has an account. | sender | RESPONSE_FIELD | VERIFIED | tests/api/kpost/signup-login/login-flow.spec.ts |
| `BR-SL-ACTIVATE` | Login before account activation must fail; activation is a separate mandatory step. | sender | REJECTION | OUT_OF_SCOPE | No activation endpoint exists in any of the 356 documented rows (CLAUDE.md §8 2026-09-12). Either activation happens outside the API, the workbook is missing it, or signup activates immediately and the rule is unimplemented — unresolved. |
| `BR-SL-JWT` | A successful login issues a signed JWT, and every authenticated operation requires a valid one. | sender | RESPONSE_FIELD, REJECTION | VERIFIED | tests/api/kpost/signup-login/login-flow.spec.ts + the engine authentication validators |
| `BR-SL-LOGOUT` | Logout invalidates the session token it was sent with. | sender | REJECTION | PARTIAL | tests/api/kpost/signup-login/login-flow.spec.ts |
| `BR-SL-PWD` | A password must be at least 8 characters with an upper case, a lower case, a digit and a special character. | sender | REJECTION | OUT_OF_SCOPE | exercising it means attempting real registrations, each of which mints a PERMANENT account KPOST cannot delete. Needs an explicit owner decision, not a test-bench one. |
| `BR-SL-3IDS` | The same account authenticates by mobile number, by bare KPost ID and by full KPost ID with domain. | sender | RESPONSE_FIELD | TO_DO | — |

## katchup

| Rule | Statement | Actors | Evidence needed | Status | Spec / gap |
| ---- | --------- | ------ | --------------- | ------ | ---------- |
| `BR-KU-SUBJECT` | Every Katchup message carries a Subject; a blank subject is stored as the literal "General", never as an empty value. | sender | RESPONSE_FIELD, READ_BACK | PARTIAL | tests/api/kpost/katchup/feature.spec.ts |
| `NFR-SEC02` | A Confidential Copy recipient is invisible to every other recipient of the same message. | recipient, copy-recipient, confidential-copy-recipient | CROSS_ACTOR, ABSENCE | VERIFIED | tests/api/kpost/katchup/feature.spec.ts |
| `BR-KU-EDIT-SUBJ` | Editing a message changes the BODY only: the Subject cannot change, and the message is marked as edited. | sender, recipient | READ_BACK, CROSS_ACTOR | PARTIAL | tests/api/kpost/katchup/feature.spec.ts |
| `BR-KU-RECALL` | A recalled message is removed from the recipient's view entirely. | sender, recipient | CROSS_ACTOR, ABSENCE | VERIFIED | tests/api/kpost/katchup/feature.spec.ts |
| `BR-KU-RECALL-UNREAD` | Recall is permitted only while the recipient has not yet read the message. | sender | REJECTION, STATE_TRANSITION | TO_DO | — |
| `BR-KU-RECALL-SCOPE` | Recall is unavailable for copies and for group messages. | sender | REJECTION | TO_DO | — |
| `BR-KU-DISAPPEAR-READ` | "Disappear After Reading" deletes the message when the recipient reads it, with no timer involved. | sender, recipient | CROSS_ACTOR, ABSENCE, STATE_TRANSITION | PARTIAL | tests/api/kpost/katchup/feature.spec.ts |
| `BR-KU-DISAPPEAR-SCHED` | "Disappear As Per Schedule" deletes the message at its scheduled time whether or not it was read. | sender, recipient | ABSENCE, STATE_TRANSITION | TO_DO | needs a flow that can wait out a real timer, which no current spec supports. |
| `BR-KU-DISAPPEAR-IMMUTABLE` | The disappearing-message setting cannot be changed after the message is sent. | sender | READ_BACK, REJECTION | TO_DO | — |
| `BR-KU-FORWARD-HIDE` | A hide-source forward does not expose the original sender to the new recipient. | sender, recipient | CROSS_ACTOR, ABSENCE | TO_DO | the forward endpoints answer 500 on the test host today (CLAUDE.md 2026-09-13), so the rule cannot yet be exercised. |
| `BR-KU-RECEIPTS` | A per-recipient read date and time is recorded, and only once that recipient has actually read the message. | sender, recipient, group-member | STATE_TRANSITION, CROSS_ACTOR | PARTIAL | tests/api/kpost/katchup/state-transition.spec.ts |
| `BR-KU-DELETE-OWN` | Deleting a received message removes it from the deleter's view only; other participants still see it. | sender, recipient | CROSS_ACTOR, ABSENCE, READ_BACK | PARTIAL | tests/api/kpost/katchup/lifecycle.spec.ts |

## group

| Rule | Statement | Actors | Evidence needed | Status | Spec / gap |
| ---- | --------- | ------ | --------------- | ------ | ---------- |
| `FR-GC-006` | A group cannot be created without at least one member besides the creator. | group-admin | REJECTION | TO_DO | — |
| `FR-GM-010` | Adding a member increases the group member count and lists that member. | group-admin, group-member | SIDE_EFFECT, READ_BACK | PARTIAL | tests/api/kpost/group/feature.spec.ts |
| `FR-GM-011` | Removing a member decreases the count and the user is no longer listed. | group-admin, group-member | SIDE_EFFECT, ABSENCE | PARTIAL | tests/api/kpost/group/feature.spec.ts |
| `FR-GM-012` | Add Admin promotes a member, after which both admins are listed as admins. | group-admin, group-member | READ_BACK | PARTIAL | tests/api/kpost/group/feature.spec.ts |
| `FR-GM-013` | Remove Admin is permitted only while more than one admin exists. | group-admin | REJECTION | TO_DO | — |
| `FR-GM-014` | The sole admin of a group cannot leave it until another admin exists. | group-admin | REJECTION | PARTIAL | tests/api/kpost/group/feature.spec.ts |
| `BR-GC-DELETE-EMPTY` | A group cannot be deleted while it still has members. | group-admin | REJECTION | VERIFIED | tests/e2e/group.spec.ts (cleanup removes members first, as the application requires) |

## kall

| Rule | Statement | Actors | Evidence needed | Status | Spec / gap |
| ---- | --------- | ------ | --------------- | ------ | ---------- |
| `BR-C01` | Rescheduling a call keeps the SAME call — the same kallID and one dashboard entry — and only moves its status to Rescheduled. | call-caller, call-participant | RESPONSE_FIELD, STATE_TRANSITION, SIDE_EFFECT | VERIFIED | tests/api/kpost/kall/feature.spec.ts (records a violation through recordBusinessRuleViolation) |
| `FR-KL-001` | A scheduled Kall requires a title, a date and a start and end time; a missing field blocks the save. | call-caller | REJECTION | TO_DO | — |
| `FR-KL-002` | Participants added to a scheduled call are recorded as invitees of that call. | call-caller, call-participant | READ_BACK | PARTIAL | tests/api/kpost/kall/feature.spec.ts |
| `FR-KL-008` | The call log records the participants, their role/team and the call duration. | call-caller, call-participant | READ_BACK, SIDE_EFFECT | TO_DO | a call cannot be completed headlessly — `kall.connected` is unreachable without a second WebRTC peer. |
| `FR-KL-009` | The call log records the exact start and end timestamps. | call-caller | READ_BACK | TO_DO | same blocker as FR-KL-008: no completed call can be produced headlessly. |

## kmail

| Rule | Statement | Actors | Evidence needed | Status | Spec / gap |
| ---- | --------- | ------ | --------------- | ------ | ---------- |
| `FR-KM-005` | The To: field accepts exactly ONE recipient; any further recipients go to Cc. | sender, recipient, copy-recipient | REJECTION | PARTIAL | tests/api/kmail/feature.spec.ts |
| `BR-M01` | Each mail records a per-recipient read receipt with the exact date and time the recipient opened it. | sender, recipient | STATE_TRANSITION, CROSS_ACTOR | TO_DO | the Phase 4D calibration read the KMail delivery/read representation but did not drive the transition. |
| `FR-KM-010` | A mail carries a priority of Low, Medium or High, defaulting to Low; High is the distinct flag. | sender, recipient | READ_BACK | PARTIAL | tests/api/kmail/feature.spec.ts |
| `BR-KM-SALUTE` | The salutation is one of {Hi, Hello, Dear, Sir, Madam, Respect}, defaulting to Hi; anything else is rejected or normalised. | sender | REJECTION, READ_BACK | TO_DO | — |
| `BR-KM-BODY` | Sending a mail requires body text. | sender | REJECTION | TO_DO | — |
| `BR-KM-EXTERNAL` | A non-KPost email address is accepted as a recipient. | sender, recipient | RESPONSE_FIELD, READ_BACK | OUT_OF_SCOPE | delivering to a real external mailbox is an `external` side effect: the SMS/OTP kill-switch class. It would need a bench-owned external mailbox and an explicit owner decision. |

## kdirectory

| Rule | Statement | Actors | Evidence needed | Status | Spec / gap |
| ---- | --------- | ------ | --------------- | ------ | ---------- |
| `FR-KD-002-ORG-SCOPE` | The directory shows only users within the viewer's own organisation. | sender | ABSENCE, CROSS_ACTOR | TO_DO | proving absence needs a known out-of-org user, and the QA-identifier guard correctly refuses naming an account we do not own — so the assertion must be built from what the response DOES contain, not from probing a stranger. |
| `FR-KD-002-SEARCH` | Directory search matches by name; a query with no match returns an empty result. | sender | RESPONSE_FIELD | PARTIAL | tests/api/kpost/contacts/read.spec.ts (contract matrix) |
| `FR-KD-003` | Each directory entry shows the name, the role/designation and the team. | sender | RESPONSE_FIELD | TO_DO | — |
| `FR-KD-005` | Opening a directory entry returns that user's full profile. | sender | RESPONSE_FIELD, CROSS_ACTOR | VERIFIED | tests/api/kpost/profile/read.spec.ts (contract matrix) |

## admin

| Rule | Statement | Actors | Evidence needed | Status | Spec / gap |
| ---- | --------- | ------ | --------------- | ------ | ---------- |
| `BR-ADM-TIER-ORDER` | The organisation build is strictly ordered: each step produces the identifier the next step needs (workplace tier → variable → location → HR tier → variable → employee). | group-admin | RESPONSE_FIELD, READ_BACK | VERIFIED | tests/api/admin/feature.spec.ts |
| `BR-ADM-500-VALIDATION` | A missing required field is answered with a client error, never a server error. | group-admin | REJECTION | VERIFIED | tests/api/admin/feature.spec.ts (the 500 is recorded as a finding) |

## cross-cutting

| Rule | Statement | Actors | Evidence needed | Status | Spec / gap |
| ---- | --------- | ------ | --------------- | ------ | ---------- |
| `NFR-SEC01` | Every authenticated operation requires a valid JWT. | sender | REJECTION | VERIFIED | src/validators/authentication/missing-token.validator.ts — with its four siblings, run by the engine on every registered endpoint |
| `BR-X01` | Read receipts behave identically in Katchup and KMail: both record a per-recipient open date and time. | sender, recipient | STATE_TRANSITION, CROSS_ACTOR | TO_DO | neither side's transition is driven yet, and the comparison BETWEEN them has no home until flow execution exists. |
| `BR-X02` | Account, password and acceptable-use rules are platform-wide, not per module. | sender | CROSS_ACTOR | TO_DO | the password rule itself is OUT_OF_SCOPE (BR-SL-PWD), so the cross-module comparison has nothing to compare yet. |
