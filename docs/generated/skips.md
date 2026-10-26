# Skip ledger — every skip reason in the suite, classified

**GENERATED — do not edit.** Written by `tests/framework/skip-ledger.spec.ts`
(`npm run test:framework`). Edit the specs, not this file.

A skip is honest only when its reason says what kind of skip it is. Five classes a skip may
be in, one it should not stay in (no reason string), and one that fails the build (unclassified).
The plan: `docs/reference/production-readiness-plan.md`, Phase 1.

| Class | Sites | Spec files |
| ----- | ----: | ---------: |
| Retune | 0 | 0 |
| Blocked by a defect | 40 | 23 |
| Provision | 326 | 232 |
| Owner decision | 204 | 147 |
| Live condition | 117 | 53 |
| No reason string | 0 | 0 |
| Unclassified | 0 | 0 |
| **Total** | **687** | **274** |

## The last run, by the engine’s own skip classes

Run `run-04aad007-f8e3-4a9b-a265-2c1d77e89897` at 2026-10-26T06:40:23.723Z: 0 checks, 0 applicable ran (0% passed), 0 skipped:

| Engine skip class | Checks | Meaning |
| ----------------- | -----: | ------- |
| notApplicable | 0 | the validator does not apply to that endpoint (by design) |
| recoverable | 0 | needs a fixture, an id or a second principal — a gap to close |
| blockedByDefect | 0 | an open defect stops the check from being meaningful |
| deliberate | 0 | an owner pause or a safety choice |
| environmental | 0 | host or transport trouble this run |

## Retune — a selector that no longer matches, or a defect; Phase 1 drives this to 0 (0)

_None._

## Blocked by a defect — an open bug stops the check from meaning anything (40)

| Sites | Reason | Where |
| ----: | ------ | ----- |
| 3 | scheduledKall did not return a kallID (status …) | `tests/api/kpost/security/kall-legacy-writes-regression-2026-10-07.spec.ts:41`, `tests/api/kpost/security/kall-legacy-writes-regression-2026-10-07.spec.ts:90`, `tests/api/kpost/security/kall-legacy-writes-regression-2026-10-07.spec.ts:136` |
| 3 | kall-initiate did not return a kallID to attack (placed replied …) | `tests/api/kpost/security/kall-object-authorization.spec.ts:66`, `tests/api/kpost/security/kall-object-authorization.spec.ts:170`, `tests/api/kpost/security/kall-object-authorization.spec.ts:444` |
| 3 | sendMessage did not return a msgID (status …) | `tests/api/kpost/security/katchup-cross-account-idor-2026-10-12.spec.ts:56`, `tests/api/kpost/security/katchup-cross-account-idor-2026-10-12.spec.ts:117`, `tests/api/kpost/security/katchup-legacy-recall-regression-2026-10-07.spec.ts:44` |
| 3 | send did not return a msgID (replied …) | `tests/api/kpost/security/katchup-idor-regression-2026-10-03.spec.ts:53`, `tests/api/kpost/security/katchup-idor-regression-2026-10-03.spec.ts:178`, `tests/api/kpost/security/katchup-idor-regression-2026-10-03.spec.ts:262` |
| 3 | group-create did not return a groupKpostID (replied …) | `tests/api/kpost/security/katchup-idor-regression-2026-10-03.spec.ts:338`, `tests/api/kpost/security/katchup-idor-regression-2026-10-03.spec.ts:435`, `tests/api/kpost/security/katchup-object-authorization.spec.ts:252` |
| 2 | kmail-post-mail did not return a kmailID (…) | `tests/api/kmail/content-idor.spec.ts:95`, `tests/api/kmail/copies-info-idor.spec.ts:88` |
| 2 | sendMessage did not return a msgID to attack (send replied …) — activates automatically once one is issued | `tests/api/kpost/security/katchup-object-authorization.spec.ts:72`, `tests/api/kpost/security/katchup-object-authorization.spec.ts:144` |
| 1 | API open call returns an empty record (kmailID 0) — the intermittent empty-record fault #1348, seen in the browser too on 2026-10-22; parked until it is fixed | `tests/api/kmail/mail-semantics-workflow.spec.ts:229` |
| 1 | Dev-confirmed 2026-09-26: this route is not in use — intentionally unavailable on this build, not a deployment gap. testkmail answers a plain Spring 404 "Not Found" for POST /draft/draftMailMultiPart, consistent with that. Not exercised, by design. | `tests/api/kmail/manage-workflow.spec.ts:261` |
| 1 | Dev-confirmed 2026-09-26: letterhead id "1" IS the shared system default — "other[s] are should be added by user for their own customization." This matches the evidence already on file (getLetterHead marks id 1 `"default":"Y"` at a generic S3 path). So deleting id 1 is confirmed unsafe, exactly as suspected — not a remaining open question. What blocks a live test now is narrower: the KMail OpenAPI contract and workbook register only get-all/get-current/get-template/set-active-by-id/delete-by-id for letterheads — no create/save/upload route a user would call to add their own, so this bench has no way to create a personal letterhead to safely delete instead. Needs the dev to name which endpoint the "add your own" flow actually calls (not documented in the KMAILAPI workbook) before this can be tested end to end; not worked around by deleting the shared default. | `tests/api/kmail/manage-workflow.spec.ts:371` |
| 1 | Dev-confirmed 2026-09-26: this route is not in use — intentionally unavailable on this build, not a deployment gap. Consistent with the plain Spring 404 "route not mapped" it returns. Not exercised, by design. | `tests/api/kmail/manage-workflow.spec.ts:398` |
| 1 | kmail-post-mail did not return a kmailID to attack (send replied …) | `tests/api/kmail/mutation-idor.spec.ts:68` |
| 1 | unOpenedMailCountBySenderID is currently 500 for every account | `tests/api/kmail/reads-workflow.spec.ts:114` |
| 1 | also blocked on #499 (kos-create-doc does not return a docId) independent of deferral | `tests/api/kpost/concurrency/scenarios.spec.ts:240` |
| 1 | katchup-send-multipart is the OLD direct-upload path — owner-confirmed 2026-09-26 that the current client uses the presigned-URL flow instead (aws-katchup-presigned + a direct S3 PUT + katchup-send-message's own uuid field). The route stays registered (generic validator sweep still runs against it) but its attachment-storage behaviour is no longer product- relevant, so it is not asserted on live. The prior finding is closed as #614 WONTFIX, not chased further. See presigned-attachment-workflow.spec.ts for the current, real upload path. | `tests/api/kpost/katchup/attachment-workflow.spec.ts:23` |
| 1 | deactivateAccount is sideEffect:'global' AND otpDependent:'requires' — doubly blocked on live. Disabling the QA account mid-suite would take every other test down with it. Never run for real; only the off-live negative probes touch it. | `tests/api/kpost/profile/device-workflow.spec.ts:127` |
| 1 | kall-scheduled did not return a kallID to attack (scheduled replied …) | `tests/api/kpost/security/kall-object-authorization.spec.ts:310` |
| 1 | send did not return a sharedMessageId (replied …) | `tests/api/kpost/security/katchup-idor-regression-2026-10-03.spec.ts:113` |
| 1 | the group send did not return a msgID (replied …) | `tests/api/kpost/security/katchup-object-authorization.spec.ts:274` |
| 1 | createEvent did not return a usable eventID; cannot continue | `tests/api/kpost/security/kdiary-object-authorization.spec.ts:76` |
| 1 | blocked by Bugzilla #499 (kword/create 500) — activates automatically once a docId is issued (create replied …) | `tests/api/kpost/security/kword-object-authorization.spec.ts:76` |
| 1 | … is genuinely already registered — set a fresh QA_SIGNUP_UI_MOBILE the signup screen's mobile Verify step is broken (a repeat of #720): it misreports this free number as taken, so the OTP modal never opens | `tests/e2e/auth/signup-login-lifecycle.spec.ts:131` |
| 1 | invalid the OTP box just rejected the bypass code — likely test-infra noise (rate-limiting from concurrent heavy traffic on this host, see #721/INVALID), not a real defect; re-run once no other suite is hitting the same API host | `tests/e2e/auth/signup-login-lifecycle.spec.ts:148` |
| 1 | the message did not send (see Katchup send defects) — edit state not reachable | `tests/e2e/katchup/katchup-functional.spec.ts:185` |
| 1 | blocked by #1343 — group thread older-page request 500s on open | `tests/e2e/katchup/katchup-group-receipts-e2e.spec.ts:121` |
| 1 | /writemail rendered the error boundary ("Something went wrong") — #990-shaped crash, reported by screens-batch4, not a compose finding | `tests/e2e/kmail/kmail-compose.spec.ts:30` |
| 1 | /writemail rendered the error boundary ("Something went wrong") — #990-shaped crash, reported by screens-batch4, not a composer-control finding | `tests/e2e/kmail/kmail-composer-controls.spec.ts:48` |
| 1 | /writemail rendered the error boundary ("Something went wrong") — #990-shaped crash, reported by screens-batch4, not a compose-fuzz finding | `tests/e2e/kmail/kmail-security.spec.ts:68` |

## Provision — an account, connection, host or secret this machine lacks (326)

| Sites | Reason | Where |
| ----: | ------ | ----- |
| 85 | qa.bench needs a real live account (QA_KPOST_ID) | `tests/e2e/auth/login-session.spec.ts:24`, `tests/e2e/auth/login-session.spec.ts:95`, `tests/e2e/auth/login-token-security.spec.ts:28`, `tests/e2e/auth/login-token-security.spec.ts:116` +81 more |
| 33 | needs the KPOST_QA connection | `tests/api/kmail/workflow-db.spec.ts:132`, `tests/api/kmail/workflow-db.spec.ts:167`, `tests/api/kpost/contacts/contacts-workflow.spec.ts:66`, `tests/api/kpost/contacts/contacts-workflow.spec.ts:94` +29 more |
| 25 | qa.bench needs both QA accounts | `tests/e2e/contacts/contacts.spec.ts:75`, `tests/e2e/cross-layer/cross-layer-flows.spec.ts:52`, `tests/e2e/group/group-exit-e2e.spec.ts:100`, `tests/e2e/group/group-security.spec.ts:26` +21 more |
| 19 | (no reason string) kmailAuthGate() !== undefined, kmailAuthGate() ?? '' | `tests/api/kmail/attachment-delete-idor.spec.ts:35`, `tests/api/kmail/attachment-idor.spec.ts:47`, `tests/api/kmail/attachment-integrity.spec.ts:36`, `tests/api/kmail/content-idor.spec.ts:54` +15 more |
| 9 | account registry says which role is missing (requireAll) | `tests/api/kmail/workflow-db.spec.ts:63`, `tests/api/kpost/contacts/contacts-workflow.spec.ts:42`, `tests/api/kpost/contacts/contacts-workflow.spec.ts:199`, `tests/api/kpost/profile/profile-workflow.spec.ts:41` +5 more |
| 9 | qa.bench needs both QA accounts (QA_KPOST_ID, QA_VICTIM_KPOST_ID) | `tests/e2e/contacts/contacts.spec.ts:18`, `tests/e2e/katchup/katchup-actions-more.spec.ts:48`, `tests/e2e/katchup/katchup-actions.spec.ts:46`, `tests/e2e/katchup/katchup-compose.spec.ts:38` +5 more |
| 8 | needs the KPOST_QA connection to judge by the row | `tests/api/kmail/mutation-idor.spec.ts:47`, `tests/api/kpost/security/kall-object-authorization.spec.ts:43`, `tests/api/kpost/security/kall-object-authorization.spec.ts:148`, `tests/api/kpost/security/kall-object-authorization.spec.ts:288` +4 more |
| 7 | qa.business needs the BUSINESS_S account (QA_BUSINESS_S_KPOST_ID) | `tests/e2e/platform/screens-business.spec.ts:25`, `tests/e2e/settings/settings-business-bank-details.spec.ts:26`, `tests/e2e/settings/settings-business-company-details.spec.ts:40`, `tests/e2e/user-management/usermanagement-accessibility.spec.ts:42` +3 more |
| 6 | qa.business.m needs the BUSINESS_M account of the QA testing company (QA_BUSINESS_M_KPOST_ID) | `tests/api/admin/endpoint-matrix.spec.ts:352`, `tests/api/admin/field-rules-sweep.spec.ts:336`, `tests/api/admin/input-hardening.spec.ts:177`, `tests/api/admin/latency.spec.ts:150` +2 more |
| 6 | qa.bench qa.bench needs both QA accounts (QA_KPOST_ID, QA_VICTIM_KPOST_ID) | `tests/api/kmail/reply-forward-workflow.spec.ts:63`, `tests/api/kpost/katchup/unread-count-clears-on-read.spec.ts:56`, `tests/e2e/katchup/katchup-received-actions.spec.ts:100`, `tests/e2e/katchup/katchup-two-session.spec.ts:58` +2 more |
| 5 | qa.business.m needs the BUSINESS_M account (QA_BUSINESS_M_KPOST_ID + QA_BUSINESS_M_COMPANY_ID) | `tests/api/admin/feature.spec.ts:102`, `tests/api/admin/reads-workflow.spec.ts:18`, `tests/api/admin/security-cross-tenant-reads.spec.ts:28`, `tests/api/admin/security-probes.spec.ts:52` +1 more |
| 5 | needs two distinct KPost principals | `tests/api/kpost/security/kall-legacy-writes-regression-2026-10-07.spec.ts:22`, `tests/api/kpost/security/kall-object-authorization.spec.ts:558`, `tests/api/kpost/security/katchup-legacy-recall-regression-2026-10-07.spec.ts:23`, `tests/api/kpost/security/katchup-object-authorization.spec.ts:42` +1 more |
| 4 | qa.bench needs a real account (QA_KPOST_ID) | `tests/e2e/platform/accessibility-axe.spec.ts:35`, `tests/e2e/platform/keyboard-nav.spec.ts:25`, `tests/e2e/platform/network-resilience.spec.ts:25`, `tests/e2e/platform/visual.spec.ts:29` |
| 3 | needs the KPOST_QA connection to assert persistence | `tests/api/kmail/workflow-db.spec.ts:71`, `tests/api/kpost/katchup/workflow-db.spec.ts:75`, `tests/api/kpost/katchup/workflow-db.spec.ts:164` |
| 3 | needs the primary account | `tests/api/kpost/profile/profile-workflow.spec.ts:78`, `tests/api/kpost/profile/profile-workflow.spec.ts:94`, `tests/api/kpost/profile/profile-workflow.spec.ts:145` |
| 3 | needs three distinct KPost principals | `tests/api/kpost/security/kall-object-authorization.spec.ts:35`, `tests/api/kpost/security/katchup-cross-account-idor-2026-10-12.spec.ts:40`, `tests/api/kpost/security/katchup-idor-regression-2026-10-03.spec.ts:29` |
| 3 | qa.bench qa.p3 needs the primary, 2nd and personal-3 QA accounts | `tests/e2e/group/group-info.spec.ts:88`, `tests/e2e/group/group-member-profile-session.spec.ts:46`, `tests/e2e/group/group-post-targeting.spec.ts:34` |
| 3 | needs both QA accounts, qatest1 and qatest3 | `tests/e2e/kmail/kmail-browse-e2e.spec.ts:34`, `tests/e2e/kmail/kmail-phone-e2e.spec.ts:28`, `tests/e2e/kmail/kmail-status-e2e.spec.ts:44` |
| 3 | needs the second QA account (QA_VICTIM_KPOST_ID) | `tests/e2e/smoke/contacts.smoke.spec.ts:16`, `tests/e2e/smoke/katchup.smoke.spec.ts:24`, `tests/e2e/smoke/kmail.smoke.spec.ts:22` |
| 2 | qa.business.m needs the BUSINESS_M account of the QA testing company (QA_BUSINESS_M_KPOST_ID + QA_BUSINESS_M_COMPANY_ID) | `tests/api/admin/role-posting-lifecycle.spec.ts:136`, `tests/api/admin/role-posting-lifecycle.spec.ts:540` |
| 2 | needs the BUSINESS_S admin principal | `tests/api/kpost/security/admin-bank-company-cross-company.spec.ts:28`, `tests/api/kpost/security/admin-usermanagement-cross-company.spec.ts:29` |
| 2 | needs a real QA_BUSINESS_M_COMPANY_ID distinct from the attacker's own company | `tests/api/kpost/security/admin-bank-company-cross-company.spec.ts:30`, `tests/api/kpost/security/admin-usermanagement-cross-company.spec.ts:31` |
| 2 | needs the personal and personal-3 principals | `tests/api/kpost/security/kdiary-object-authorization.spec.ts:62`, `tests/api/kpost/security/profile-record-object-authorization.spec.ts:57` |
| 2 | needs QA_PASSWORD | `tests/api/kpost/signup-login/security-session.spec.ts:99`, `tests/api/kpost/signup-login/security-session.spec.ts:158` |
| 2 | no KPost principal configured | `tests/api/kpost/signup-login/security-session.spec.ts:114`, `tests/api/kpost/signup-login/security-session.spec.ts:161` |
| 2 | not configured for this run: … | `tests/api/smoke/admin.smoke.spec.ts:17`, `tests/api/smoke/api.smoke.spec.ts:19` |
| 2 | qa.bench needs a real live account | `tests/e2e/kall/kall-features.spec.ts:114`, `tests/e2e/profile/profile-actions.spec.ts:67` |
| 2 | qa.bench needs a live QA account | `tests/e2e/kmail/kmail-api-handling.spec.ts:22`, `tests/e2e/platform/app-hardcoded-host.spec.ts:26` |
| 2 | needs a second QA account as the recipient | `tests/e2e/kmail/kmail-composer-controls.spec.ts:289`, `tests/e2e/kmail/kmail-composer-controls.spec.ts:334` |
| 1 | roleEmployeeMobile roleEmployeeEmail needs ADMIN_ROLE_POSTING_LIVE=true and the reserved QA employee identity (QA_ROLE_EMPLOYEE_MOBILE/EMAIL) | `tests/api/admin/latency.spec.ts:273` |
| 1 | list delete maintenance only: set ADMIN_QA_CLEANUP=list (read-only) or ADMIN_QA_CLEANUP=delete | `tests/api/admin/qa-leftovers-cleanup.spec.ts:42` |
| 1 | roleEmployeeMobile roleEmployeeEmail needs the reserved QA test-employee identity in .env (QA_ROLE_EMPLOYEE_MOBILE + QA_ROLE_EMPLOYEE_EMAIL) | `tests/api/admin/role-posting-lifecycle.spec.ts:132` |
| 1 | needs ADMIN_API_BASE_URL (the Admin test box) | `tests/api/admin/sanity-read-sweep.spec.ts:19` |
| 1 | needs both BUSINESS_M and BUSINESS_S principals | `tests/api/admin/security-cross-tenant-reads.spec.ts:27` |
| 1 | qa.business.m roleEmployeeMobile roleEmployeeEmail needs the QA company admin (QA_BUSINESS_M_*) and the QA employee identity (QA_ROLE_EMPLOYEE_*) | `tests/api/admin/setup-staff-employee.spec.ts:37` |
| 1 | needs four distinct QA principals configured (QA_* accounts) | `tests/api/kmail/copies-info-idor.spec.ts:49` |
| 1 | needs three QA accounts | `tests/api/kmail/mail-semantics-workflow.spec.ts:52` |
| 1 | needs provisioned qatest_* accounts | `tests/api/kmail/workflow-db.spec.ts:69` |
| 1 | needs the KPOST_QA connection to resolve the real membership id | `tests/api/kpost/group/feature.spec.ts:371` |
| 1 | needs the KPOST_QA database to see read_time | `tests/api/kpost/katchup/offline-delivery.spec.ts:81` |
| 1 | needs the KPOST_QA connection (DB_HOST/DB_NAME) to prove the account exists | `tests/api/kpost/profile/directory-lookup.spec.ts:72` |
| 1 | set QA_COMPANY_NAME to a real company name to unblock this | `tests/api/kpost/profile/feature.spec.ts:383` |
| 1 | qa.p5 needs a real QA_PERSONAL_5_KPOST_ID account not already in the attacker's contacts | `tests/api/kpost/security/kall-object-authorization.spec.ts:563` |
| 1 | needs a KPost principal | `tests/api/kpost/security/katchup-filter-messageby-leak-guard-2026-10-12.spec.ts:22` |
| 1 | needs the personal-5 and victim principals | `tests/api/kpost/security/katchup-object-authorization.spec.ts:208` |
| 1 | needs two distinct KPost principals (personal + personal-3) | `tests/api/kpost/security/object-authorization.spec.ts:54` |
| 1 | needs the shared QA password to act as a second account | `tests/api/kpost/security/object-authorization.spec.ts:55` |
| 1 | needs the KPOST_QA connection to judge by the row, not the reply | `tests/api/kpost/security/object-authorization.spec.ts:114` |
| 1 | the legacy reference account is absent from this target | `tests/api/kpost/signup-login/domain-policy.spec.ts:220` |
| 1 | set QA_NEG_KPOST_ID + QA_NEG_PASSWORD to a dedicated throwaway account so wrong-password attempts never lock the primary QATEST account | `tests/api/kpost/signup-login/login-flow.spec.ts:128` |
| 1 | no.such.user.9f2a@kpost.in set QA_FORGOT_PASSWORD_KPOST_ID to a spare account whose password may be rewritten; unset, this flow has no safe target | `tests/api/kpost/signup-login/otp-signup-lifecycle.spec.ts:444` |
| 1 | set QA_LOGIN_MISMATCH_MOBILE to a registered India mobile to exercise the country/number mismatch | `tests/e2e/auth/login-country-mobile-mismatch.spec.ts:26` |
| 1 | no.such.user needs a real spare account — set QA_FORGOT_PASSWORD_KPOST_ID (never QA_KPOST_ID) | `tests/e2e/auth/login-forgot-password-lifecycle.spec.ts:44` |
| 1 | needs the KPOST_QA database (DB_ENABLED) to read the OTP that was sent | `tests/e2e/auth/login-forgot-password-lifecycle.spec.ts:65` |
| 1 | needs QA_KPOST_ID | `tests/e2e/auth/login-functional.spec.ts:44` |
| 1 | qa.bench needs a real, known KPOST ID to reach the password step | `tests/e2e/auth/login-submit-locks-inputs.spec.ts:19` |
| 1 | needs the KPOST_QA database (DB_ENABLED) to pick the id and remove it | `tests/e2e/auth/sanity-signup.spec.ts:68` |
| 1 | already-exists … was reported as already registered — unexpected on the Business path per source, but handled defensively; set a fresh QA_SIGNUP_BUSINESS_UI_MOBILE | `tests/e2e/auth/signup-business.spec.ts:371` |
| 1 | taken "…" is already registered — set a fresh QA_SIGNUP_BUSINESS_COMPANY_NAME | `tests/e2e/auth/signup-business.spec.ts:403` |
| 1 | taken "…" is already taken — set a fresh QA_SIGNUP_BUSINESS_UNIQUE_NAME | `tests/e2e/auth/signup-business.spec.ts:407` |
| 1 | taken ….… is taken — set a fresh QA_SIGNUP_BUSINESS_DESIGNATION_ID or QA_SIGNUP_BUSINESS_UNIQUE_NAME | `tests/e2e/auth/signup-business.spec.ts:414` |
| 1 | taken … is taken under a different mobile than … — set a fresh QA_SIGNUP_UI_KPOST_ID_LOCAL | `tests/e2e/auth/signup-login-lifecycle.spec.ts:170` |
| 1 | already-exists … is already registered — set a fresh QA_SIGNUP_MOBILE_VIEWPORT_UI_MOBILE | `tests/e2e/auth/signup-mobile-lifecycle.spec.ts:55` |
| 1 | taken … is taken — set a fresh QA_SIGNUP_MOBILE_VIEWPORT_UI_KPOST_ID_LOCAL | `tests/e2e/auth/signup-mobile-lifecycle.spec.ts:79` |
| 1 | qa.bench needs a real, already-registered live account (QA_KPOST_ID) as the known-taken value | `tests/e2e/auth/signup-validation.spec.ts:287` |
| 1 | needs the KPOST_QA connection (DB_HOST/DB_NAME) for the database half | `tests/e2e/cross-layer/cross-layer-login.spec.ts:59` |
| 1 | needs QA_PASSWORD to drive a real login | `tests/e2e/cross-layer/cross-layer-login.spec.ts:63` |
| 1 | qa.p4 needs a configured personal-4 account to add | `tests/e2e/group/group-info.spec.ts:218` |
| 1 | qa.bench needs both QA accounts (a group needs at least one other member) | `tests/e2e/group/group.spec.ts:26` |
| 1 | qa.business needs the BUSINESS_S company admin account (QA_BUSINESS_S_KPOST_ID) | `tests/e2e/journeys/business-admin.spec.ts:26` |
| 1 | the directory returned no one for QA_MOBILE_EXISTS right now (live condition) | `tests/e2e/journeys/contacts.spec.ts:53` |
| 1 | needs the KPOST_QA database to pick the identity and remove it | `tests/e2e/journeys/first-use.spec.ts:90` |
| 1 | qa.bench needs a real live account and a 2nd account to open a conversation with | `tests/e2e/katchup/chat-avatar-session.spec.ts:37` |
| 1 | qa.victim needs the 2nd QA account (QA_VICTIM_KPOST_ID) to open a conversation with | `tests/e2e/katchup/katchup-composer-controls.spec.ts:35` |
| 1 | qa.bench needs the second QA account (QA_VICTIM_KPOST_ID) | `tests/e2e/katchup/katchup-continuous.spec.ts:32` |
| 1 | needs 3 QA accounts (QA_KPOST_ID, QA_VICTIM_KPOST_ID, QA_PERSONAL_3_KPOST_ID) | `tests/e2e/katchup/katchup-copies.spec.ts:53` |
| 1 | qa.bench qa.p3 needs all three QA accounts (QA_KPOST_ID, QA_VICTIM_KPOST_ID, a configured personal-3 account) | `tests/e2e/katchup/katchup-group-receipts-e2e.spec.ts:85` |
| 1 | qa.bench needs the primary QA account | `tests/e2e/katchup/katchup-report-contact-e2e.spec.ts:29` |
| 1 | needs both QA accounts | `tests/e2e/kmail/kmail-actions-e2e.spec.ts:34` |
| 1 | needs the three QA accounts | `tests/e2e/kmail/kmail-features-e2e.spec.ts:42` |
| 1 | needs the primary QA account | `tests/e2e/kmail/kmail-settings-e2e.spec.ts:33` |
| 1 | qa.bench the authenticated checks need a real live account (QA_KPOST_ID) | `tests/e2e/platform/monitoring-smoke.spec.ts:75` |
| 1 | qa.bench needs a live, logged-in QA account | `tests/e2e/platform/performance-single-user.spec.ts:47` |
| 1 | needs a real live account (QA_VICTIM_KPOST_ID) | `tests/e2e/profile/profile-webview.spec.ts:59` |
| 1 | the Company Registration edit form was not showing right now (needs the BUSINESS_S session; path unverified since 2026-10-11) | `tests/e2e/settings/settings-business-company-details.spec.ts:71` |
| 1 | qa.p5 needs the spare QA account (QA_PERSONAL_5_KPOST_ID) | `tests/e2e/smoke/auth.smoke.spec.ts:18` |
| 1 | needs the group-creator QA account (personal-3) | `tests/e2e/smoke/group.smoke.spec.ts:18` |
| 1 | needs a configured admin host | `tests/e2e-admin/auth/admin-login.spec.ts:17` |
| 1 | ADMIN_MONGO_URI is not configured (read-only) — needed to judge the Admin document | `tests/e2e-admin/cross-layer/admin-cross-layer.spec.ts:61` |
| 1 | "Add From Application" tab not reachable with this account\'s role value | `tests/e2e-admin/screens/admin-dead-screens.spec.ts:52` |
| 1 | an Admin connection has been configured | `tests/framework/admin-db-safety.spec.ts:92` |
| 1 | no local .env on this machine (fresh checkout / CI) | `tests/framework/env-template.spec.ts:65` |
| 1 | needs at least two configured accounts | `tests/framework/kmail-flags.spec.ts:156` |
| 1 | no finding supplied — pass --bug=<file.json> (see the usage block above) | `tests/framework/manual-bug.spec.ts:148` |
| 1 | needs BUGZILLA_URL and BUGZILLA_API_KEY | `tests/framework/ownership.spec.ts:279` |
| 1 | no pre-run snapshot found — run _snapshot-accounts.local.spec.ts first | `tests/framework/_diff-accounts.local.spec.ts:12` |

## Owner decision — gated flows, pauses and safety choices (204)

| Sites | Reason | Where |
| ----: | ------ | ----- |
| 12 | the mobile OTP bypass code only validates on the confirmed OTP test gateway | `tests/e2e/auth/signup-business-medium-large.spec.ts:37`, `tests/e2e/auth/signup-business-medium-large.spec.ts:191`, `tests/e2e/auth/signup-business.spec.ts:349`, `tests/e2e/auth/signup-kpostid-length-validation.spec.ts:30` +8 more |
| 9 | writes real messages; set KATCHUP_UI_LIFECYCLE=true | `tests/e2e/katchup/katchup-actions-more.spec.ts:44`, `tests/e2e/katchup/katchup-actions.spec.ts:42`, `tests/e2e/katchup/katchup-copies.spec.ts:49`, `tests/e2e/katchup/katchup-forward-subflow-e2e.spec.ts:59` +5 more |
| 7 | (no reason string) process.env.CONCURRENCY_LIFECYCLE !== 'true', DEFERRED_REASON | `tests/api/kpost/concurrency/scenarios.spec.ts:74`, `tests/api/kpost/concurrency/scenarios.spec.ts:121`, `tests/api/kpost/concurrency/scenarios.spec.ts:239`, `tests/api/kpost/concurrency/scenarios.spec.ts:298` +3 more |
| 5 | writes to the QA company; set ADMIN_LIFECYCLE=true | `tests/api/admin/endpoint-matrix.spec.ts:348`, `tests/api/admin/field-rules-sweep.spec.ts:332`, `tests/api/admin/input-hardening.spec.ts:173`, `tests/api/admin/latency.spec.ts:146` +1 more |
| 5 | (no reason string) process.env.SIGNUP_UI_LIFECYCLE !== 'true', 'drives the real signup screen (a mo | `tests/e2e/auth/signup-business-medium-large.spec.ts:187`, `tests/e2e/auth/signup-kpostid-length-validation.spec.ts:26`, `tests/e2e/auth/signup-login-api-handling.spec.ts:32`, `tests/e2e/auth/signup-pincode-validation.spec.ts:28` +1 more |
| 5 | sends real mails; set KMAIL_UI_LIFECYCLE=true | `tests/e2e/kmail/kmail-actions-e2e.spec.ts:26`, `tests/e2e/kmail/kmail-browse-e2e.spec.ts:30`, `tests/e2e/kmail/kmail-features-e2e.spec.ts:34`, `tests/e2e/kmail/kmail-phone-e2e.spec.ts:24` +1 more |
| 5 | sends a real mail; set KMAIL_UI_LIFECYCLE=true | `tests/e2e/kmail/kmail-compose.spec.ts:78`, `tests/e2e/kmail/kmail-read-receipt-e2e.spec.ts:94`, `tests/e2e/kmail/kmail-security.spec.ts:27`, `tests/e2e/kmail/kmail-stored-xss-render.spec.ts:51` +1 more |
| 5 | needs the BUSINESS_S admin session; set BUSINESS_UI_LIFECYCLE=true | `tests/e2e/platform/screens-business.spec.ts:21`, `tests/e2e/settings/settings-business-bank-details.spec.ts:22`, `tests/e2e/user-management/usermanagement-accessibility.spec.ts:38`, `tests/e2e/user-management/usermanagement-security.spec.ts:27` +1 more |
| 4 | needs auth2.setup.ts for the 2nd account; set KATCHUP_UI_LIFECYCLE=true | `tests/e2e/kmail/kmail-actions-e2e.spec.ts:30`, `tests/e2e/kmail/kmail-features-e2e.spec.ts:38`, `tests/e2e/kmail/kmail-status-e2e.spec.ts:163`, `tests/e2e/kmail/kmail-status-e2e.spec.ts:329` |
| 4 | qa.business needs ADMIN_UI_LIFECYCLE=true, a configured admin host and BUSINESS_M account | `tests/e2e-admin/human-resources/admin-employee-management-pii.spec.ts:27`, `tests/e2e-admin/screens/admin-dead-screens.spec.ts:17`, `tests/e2e-admin/screens/admin-screens.spec.ts:33`, `tests/e2e-admin/screens/admin-subtabs-health.spec.ts:20` |
| 3 | uploads a real file to S3 and sends a real mail; set KMAIL_LIFECYCLE=true and AWS_LIFECYCLE=true | `tests/api/kmail/attachment-delete-idor.spec.ts:36`, `tests/api/kmail/attachment-idor.spec.ts:48`, `tests/api/kmail/attachment-integrity.spec.ts:37` |
| 3 | sends a real mail; set KMAIL_LIFECYCLE=true | `tests/api/kmail/content-idor.spec.ts:55`, `tests/api/kmail/copies-info-idor.spec.ts:45`, `tests/api/kmail/mutation-idor.spec.ts:37` |
| 3 | uploads a real file to S3 and sends a real message; set KATCHUP_LIFECYCLE=true and AWS_LIFECYCLE=true | `tests/api/kpost/katchup/attachment-integrity.spec.ts:40`, `tests/api/kpost/katchup/presigned-attachment-workflow.spec.ts:27`, `tests/api/kpost/security/katchup-attachment-idor.spec.ts:33` |
| 3 | sends a real message; set KATCHUP_LIFECYCLE=true | `tests/api/kpost/security/katchup-cross-account-idor-2026-10-12.spec.ts:41`, `tests/api/kpost/security/katchup-legacy-recall-regression-2026-10-07.spec.ts:24`, `tests/api/kpost/security/katchup-object-authorization.spec.ts:43` |
| 3 | needs auth2.setup.ts to log the 2nd account in; set KATCHUP_UI_LIFECYCLE=true | `tests/e2e/group/group-exit-e2e.spec.ts:96`, `tests/e2e/kmail/kmail-read-receipt-e2e.spec.ts:98`, `tests/e2e/kmail/kmail-two-session-e2e.spec.ts:28` |
| 3 | creates and deletes a real group; set GROUP_UI_LIFECYCLE=true | `tests/e2e/group/group-info.spec.ts:84`, `tests/e2e/group/group-member-profile-session.spec.ts:42`, `tests/e2e/group/group-post-targeting.spec.ts:30` |
| 3 | sends a real message; set KATCHUP_UI_LIFECYCLE=true | `tests/e2e/katchup/katchup-compose.spec.ts:77`, `tests/e2e/katchup/katchup-digitalcard-share-e2e.spec.ts:56`, `tests/e2e/katchup/katchup-secret-message-e2e.spec.ts:18` |
| 3 | edits a profile field; set PROFILE_UI_LIFECYCLE=true | `tests/e2e/profile/profile-edit.spec.ts:26`, `tests/e2e/profile/profile-functional.spec.ts:79`, `tests/e2e/profile/profile-security.spec.ts:26` |
| 2 | writes real org structure; set ADMIN_LIFECYCLE=true | `tests/api/admin/feature.spec.ts:98`, `tests/api/admin/write-fuzz-workflow.spec.ts:239` |
| 2 | creates real KPost (testingapi) + KSMACC accounts for the QA company; set ADMIN_LIFECYCLE=true and ADMIN_ROLE_POSTING_LIVE=true | `tests/api/admin/role-posting-lifecycle.spec.ts:128`, `tests/api/admin/role-posting-lifecycle.spec.ts:536` |
| 2 | writes a real message; set KATCHUP_LIFECYCLE=true to run (owner sign-off, flow doc Q4) | `tests/api/kpost/katchup/lifecycle.spec.ts:24`, `tests/api/kpost/katchup/workflow-db.spec.ts:44` |
| 2 | creates a real diary event; set KDIARY_LIFECYCLE=true | `tests/api/kpost/kdiary/kdiary-reads-workflow.spec.ts:32`, `tests/api/kpost/security/kdiary-object-authorization.spec.ts:58` |
| 2 | creates a real, permanent company; set SIGNUP_UI_LIFECYCLE=true | `tests/e2e/auth/signup-business-medium-large.spec.ts:33`, `tests/e2e/auth/signup-business.spec.ts:345` |
| 2 | drives a real mobile OTP to reach this step; set SIGNUP_UI_LIFECYCLE=true | `tests/e2e/auth/signup-login-accessibility.spec.ts:217`, `tests/e2e/auth/signup-login-accessibility.spec.ts:246` |
| 2 | creates a real account and sends a real mail-OTP/e-mail; set SIGNUP_UI_LIFECYCLE=true | `tests/e2e/auth/signup-login-lifecycle.spec.ts:55`, `tests/e2e/auth/signup-mobile-lifecycle.spec.ts:31` |
| 2 | creates a real group; set GROUP_UI_LIFECYCLE=true | `tests/e2e/cross-layer/cross-layer-flows.spec.ts:275`, `tests/e2e/group/group.spec.ts:22` |
| 2 | creates a real scheduled call; set KALL_UI_LIFECYCLE=true | `tests/e2e/cross-layer/cross-layer-flows.spec.ts:412`, `tests/e2e/kall/kall-features.spec.ts:110` |
| 2 | only meaningful when TEST_ENV=production | `tests/framework/live-safety.spec.ts:573`, `tests/framework/live-safety.spec.ts:606` |
| 1 | one-time setup: set ADMIN_CREATE_STAFF=true and ADMIN_ROLE_POSTING_LIVE=true | `tests/api/admin/setup-staff-employee.spec.ts:33` |
| 1 | PERMANENT on this environment (sideEffect:"global", refused by production-guard.ts) AND requires explicit authorization even on a future non-production environment, given it compares real credential material — see docs/scope/blocked-endpoints-rationale.md | `tests/api/kmail/credential-disclosure.spec.ts:75` |
| 1 | sends real mail; set KMAIL_LIFECYCLE=true | `tests/api/kmail/feature.spec.ts:91` |
| 1 | sends real KMail between our accounts; set KMAIL_LIFECYCLE=true | `tests/api/kmail/mail-semantics-workflow.spec.ts:48` |
| 1 | writes real KMail data; set KMAIL_LIFECYCLE=true | `tests/api/kmail/manage-workflow.spec.ts:46` |
| 1 | sensitive: sends a password and returns the account's real mail-send credentials. The endpoint's own definition explicitly says NOT to drive it on live. Recorded as a deliberate gap, not a workaround. | `tests/api/kmail/manage-workflow.spec.ts:388` |
| 1 | sends real KMail between our two accounts; set KMAIL_LIFECYCLE=true | `tests/api/kmail/reply-forward-workflow.spec.ts:59` |
| 1 | writes real KMail settings; set KMAIL_LIFECYCLE=true | `tests/api/kmail/signature-letterhead-workflow.spec.ts:37` |
| 1 | sends real mail on a LIVE mail server; set KMAIL_LIFECYCLE=true to run | `tests/api/kmail/workflow-db.spec.ts:51` |
| 1 | PERMANENT on this environment: addingUserByAdmin/createOrRemoveBackupAdmin/resetPassword/ terminateUser are all sideEffect:"global", which production-guard.ts refuses unconditionally on TEST_ENV=production — needs a non-production environment, not a flag (see docs/scope/blocked-endpoints-rationale.md) | `tests/api/kpost/admin/member-lifecycle.spec.ts:77` |
| 1 | S3 attachment lifecycle; set AWS_LIFECYCLE=true | `tests/api/kpost/aws/feature.spec.ts:41` |
| 1 | testingapi answers 404 "No matching endpoint for this request" for POST saveUnsubscriberDetails, live-verified 2026-09-24. Not run standalone (a 404 there reads  | `tests/api/kpost/common/common-gaps.spec.ts:28` |
| 1 | sideEffect:'global', never cleared for live under any flag — the endpoint's own definition warns a wrong value here is a production incident. Never run for real; the off-live negative probes are the only thing that touches it. | `tests/api/kpost/common/common-gaps.spec.ts:38` |
| 1 | all three need a COMPANY_ADMIN token and two are sideEffect:'global'. The endpoint definitions' own extensive documented investigation (company.api.ts) already traced downloadCompanyLogo's 500-for-every-caller to two candidates (a broken route, or a missing- logo 500-instead-of-404) and explicitly declined to resolve it by uploading a real logo on a token given for reference, "not something to do unasked." That stands unless the owner explicitly authorizes driving these live. | `tests/api/kpost/common/common-gaps.spec.ts:48` |
| 1 | the OTP flows are opened only with OTP_TEST_GATEWAY=true and TEST_DB_MODE=true | `tests/api/kpost/common/forgot-password-limited.spec.ts:19` |
| 1 | writes the block state; set CONTACTS_LIFECYCLE=true | `tests/api/kpost/contacts/contacts-lists-workflow.spec.ts:106` |
| 1 | writes to the address book; set CONTACTS_LIFECYCLE=true | `tests/api/kpost/contacts/feature.spec.ts:53` |
| 1 | creates real groups; set GROUP_LIFECYCLE=true | `tests/api/kpost/group/feature.spec.ts:125` |
| 1 | maintenance only; set QA_GROUP_CLEANUP=true | `tests/api/kpost/group/qa-ui-group-cleanup.spec.ts:41` |
| 1 | places real calls between the QA accounts; set KALL_LIFECYCLE=true | `tests/api/kpost/kall/call-states.spec.ts:128` |
| 1 | places/schedules real calls; set KALL_LIFECYCLE=true (owner sign-off, docs/modules/kall-flow.md §5) | `tests/api/kpost/kall/feature.spec.ts:82` |
| 1 | places a real call; set KALL_LIFECYCLE=true (owner sign-off, docs/modules/kall-flow.md §5) | `tests/api/kpost/kall/kall-reads-workflow.spec.ts:72` |
| 1 | schedules a real call; set KALL_LIFECYCLE=true (owner sign-off, docs/modules/kall-flow.md §5) | `tests/api/kpost/kall/kall-reads-workflow.spec.ts:169` |
| 1 | schedules a real repeating call; set KALL_LIFECYCLE=true (owner sign-off, docs/modules/kall-flow.md §5) | `tests/api/kpost/kall/kall-reads-workflow.spec.ts:229` |
| 1 | writes real messages; set KATCHUP_LIFECYCLE=true (owner sign-off, docs/modules/katchup-flow.md §6) | `tests/api/kpost/katchup/feature.spec.ts:123` |
| 1 | sends a real message between the QA accounts; set KATCHUP_LIFECYCLE=true | `tests/api/kpost/katchup/offline-delivery.spec.ts:69` |
| 1 | sends real messages between the QA accounts; set KATCHUP_LIFECYCLE=true | `tests/api/kpost/katchup/rules.spec.ts:102` |
| 1 | sends a real message to get an id to test with; set KATCHUP_LIFECYCLE=true | `tests/api/kpost/katchup/shared-reference-workflow.spec.ts:35` |
| 1 | sends a real message between our two accounts; set KATCHUP_LIFECYCLE=true (owner sign-off) | `tests/api/kpost/katchup/unread-count-clears-on-read.spec.ts:52` |
| 1 | real third-party seat hold, unconfirmed sandbox — needs explicit authorization | `tests/api/kpost/kbooking/feature.spec.ts:172` |
| 1 | writes real diary events; set KDIARY_LIFECYCLE=true | `tests/api/kpost/kdiary/feature.spec.ts:74` |
| 1 | creates a real diary event and report; set KDIARY_LIFECYCLE=true | `tests/api/kpost/kdiary/kdiary-reads-workflow.spec.ts:102` |
| 1 | writes real KWord docs; set KOS_LIFECYCLE=true | `tests/api/kpost/kos/feature.spec.ts:55` |
| 1 | metered AI calls; set KOS_AI_LIVE=true to run | `tests/api/kpost/kos/feature.spec.ts:208` |
| 1 | testingapi answers 404 "No matching endpoint for this request" for GET /kword/documents/ — the KWord list route is not deployed on this test build (see the endpoint definition's own  | `tests/api/kpost/kos/feature.spec.ts:329` |
| 1 | sendPrimaryDeviceOtp is otpDependent:'sends' with sideEffect:'external' — the SMS/OTP kill-switch in destructiveBlockReason() refuses it against any real host in every mode. Only a confirmed OTP test gateway (OTP_TEST_GATEWAY + TEST_DB_MODE, neither configured here) would open it. Not worked around: sending a real OTP on a normal run would cost money and exhaust the SMS gateway. | `tests/api/kpost/profile/device-workflow.spec.ts:36` |
| 1 | sendPrimaryOrSecondaryDeviceOtp is otpDependent:'sends' with sideEffect:'external' — same SMS/OTP kill-switch as sendPrimaryDeviceOtp above. | `tests/api/kpost/profile/device-workflow.spec.ts:48` |
| 1 | sendAccountDeactivationOtp is otpDependent:'sends' with sideEffect:'external' — same SMS/OTP kill-switch, and it is the OTP step of the account-deactivation flow, which stays blocked in its own right below regardless. | `tests/api/kpost/profile/device-workflow.spec.ts:57` |
| 1 | forgotPasswordOrKpostID is otpDependent:'sends' with sideEffect:'external' — a public (unauthenticated) recovery entry point that sends a real OTP; same kill-switch as the others above. | `tests/api/kpost/profile/device-workflow.spec.ts:67` |
| 1 | setDeviceAsPrimary is otpDependent:'requires' AND matches the guard's isSessionDestroyer pattern — blocked even when OTP_TEST_GATEWAY+TEST_DB_MODE are both set, specifically because it would displace the primary device of the account every other test in the suite is logged in as, breaking every later test in the run. Not worked around: there is no safe way to exercise this against the suite's own live session. | `tests/api/kpost/profile/device-workflow.spec.ts:77` |
| 1 | updateDeviceAsPrimary matches the same isSessionDestroyer pattern as setDeviceAsPrimary above, for the same reason. | `tests/api/kpost/profile/device-workflow.spec.ts:89` |
| 1 | setDeviceAsSecondary matches the isSessionDestroyer pattern (updateDeviceAs*/setDeviceAs*) for the same reason as the primary-device pair above. | `tests/api/kpost/profile/device-workflow.spec.ts:98` |
| 1 | updateDeviceAsSecondary matches the isSessionDestroyer pattern for the same reason as the others above. | `tests/api/kpost/profile/device-workflow.spec.ts:107` |
| 1 | changePassword is sideEffect:'global', never cleared for live under any flag. Running it would change the credential every other suite/test logs in with mid-run — a self-inflicted lockout, not a defect to find. The documented sample is also missing a distinct newPassword field from confirmPassword, which the null/required negative probes already exercise off-live. | `tests/api/kpost/profile/device-workflow.spec.ts:116` |
| 1 | writes real profile data; set PROFILE_LIFECYCLE=true to run | `tests/api/kpost/profile/feature.spec.ts:69` |
| 1 | schedules a real call; set KALL_LIFECYCLE=true | `tests/api/kpost/security/kall-legacy-writes-regression-2026-10-07.spec.ts:23` |
| 1 | places a real call; set KALL_LIFECYCLE=true | `tests/api/kpost/security/kall-object-authorization.spec.ts:36` |
| 1 | sends real messages / creates real groups; set KATCHUP_LIFECYCLE=true | `tests/api/kpost/security/katchup-idor-regression-2026-10-03.spec.ts:30` |
| 1 | creates a real document; set KOS_LIFECYCLE=true | `tests/api/kpost/security/kword-object-authorization.spec.ts:38` |
| 1 | creates real profile records; set PROFILE_LIFECYCLE=true | `tests/api/kpost/security/profile-record-object-authorization.spec.ts:53` |
| 1 | changes account preferences; set SETTINGS_LIFECYCLE=true | `tests/api/kpost/settings/feature.spec.ts:43` |
| 1 | OTP flows run only on a confirmed test gateway: OTP_TEST_GATEWAY=true + TEST_DB_MODE=true | `tests/api/kpost/signup-login/otp-lifecycle-db.spec.ts:48` |
| 1 | needs a real 10-minute wait; set OTP_EXPIRY_WAIT=true to run the expiry boundary | `tests/api/kpost/signup-login/otp-lifecycle-db.spec.ts:473` |
| 1 | OTP/signup flows run only on a confirmed test gateway: OTP_TEST_GATEWAY=true + TEST_DB_MODE=true | `tests/api/kpost/signup-login/otp-signup-lifecycle.spec.ts:26` |
| 1 | mints a permanent company/tenant on the test DB; set BUSINESS_SIGNUP_LIVE=true to run it. Confirmed live 2026-10-02: registers QA Bench API Business Co end to end. | `tests/api/kpost/signup-login/otp-signup-lifecycle.spec.ts:284` |
| 1 | logs in and out repeatedly; set LOGIN_UI_LIFECYCLE=true | `tests/e2e/auth/login-forgot-password-lifecycle.spec.ts:36` |
| 1 | sends ONE real SMS to the spare account; set FORGOT_PASSWORD_SMS=true (the run levels do) | `tests/e2e/auth/login-forgot-password-lifecycle.spec.ts:40` |
| 1 | ends the session; set LOGIN_UI_LIFECYCLE=true | `tests/e2e/auth/login-session.spec.ts:91` |
| 1 | logs the shared account out and invalidates the saved session; set SESSION_INVALIDATION_CHECK=true and run in isolation | `tests/e2e/auth/login-token-security.spec.ts:112` |
| 1 | creates (and removes) a real account; set SIGNUP_UI_LIFECYCLE=true | `tests/e2e/auth/sanity-signup.spec.ts:34` |
| 1 | the signup OTP is mocked only on the confirmed test gateway (OTP_TEST_GATEWAY + TEST_DB_MODE) | `tests/e2e/auth/sanity-signup.spec.ts:38` |
| 1 | the account is removed from KPOST_QA afterwards; set DB_ALLOW_WRITES=true | `tests/e2e/auth/sanity-signup.spec.ts:42` |
| 1 | needs the OTP test gateway; set OTP_TEST_GATEWAY=true TEST_DB_MODE=true | `tests/e2e/auth/signup-business.spec.ts:151` |
| 1 | drives a real mobile OTP to reach these screens; set SIGNUP_UI_LIFECYCLE=true | `tests/e2e/auth/signup-screens-post-otp.spec.ts:53` |
| 1 | adds a real contact; set CONTACTS_UI_LIFECYCLE=true | `tests/e2e/contacts/contacts-functional.spec.ts:190` |
| 1 | blocks a real contact; set CONTACTS_UI_LIFECYCLE=true | `tests/e2e/contacts/contacts.spec.ts:71` |
| 1 | sends real messages and mails; set KATCHUP_UI_LIFECYCLE=true and KMAIL_UI_LIFECYCLE=true | `tests/e2e/cross-layer/cross-layer-flows.spec.ts:48` |
| 1 | creates real groups; set GROUP_UI_LIFECYCLE=true | `tests/e2e/group/group-exit-e2e.spec.ts:92` |
| 1 | Recents shows a load-error state, not an empty state — out of scope for this test | `tests/e2e/home/home-recents-search-empty-state.spec.ts:36` |
| 1 | drives real uploads + sends; set KATCHUP_UI_LIFECYCLE=true | `tests/e2e/katchup/katchup-attach-repeat-e2e.spec.ts:40` |
| 1 | drives a real presigned upload + send; set KATCHUP_UI_LIFECYCLE=true | `tests/e2e/katchup/katchup-attach-send-e2e.spec.ts:21` |
| 1 | sends real messages; set KATCHUP_UI_LIFECYCLE=true | `tests/e2e/katchup/katchup-content-correctness.spec.ts:68` |
| 1 | writes real messages; set KATCHUP_UI_LIFECYCLE=true (npm run ui does) | `tests/e2e/katchup/katchup-continuous.spec.ts:28` |
| 1 | types into a real composer; set KATCHUP_UI_LIFECYCLE=true | `tests/e2e/katchup/katchup-draft-persistence.spec.ts:35` |
| 1 | drives the composer/send; set KATCHUP_UI_LIFECYCLE=true | `tests/e2e/katchup/katchup-functional.spec.ts:67` |
| 1 | creates a real group and sends a real message; set KATCHUP_UI_LIFECYCLE=true | `tests/e2e/katchup/katchup-group-receipts-e2e.spec.ts:81` |
| 1 | sends and forwards real messages; set KATCHUP_UI_LIFECYCLE=true | `tests/e2e/katchup/katchup-multi-forward-e2e.spec.ts:45` |
| 1 | (no reason string) process.env.KATCHUP_UI_LIFECYCLE !== 'true', 'confirms a real report (and may bl | `tests/e2e/katchup/katchup-report-contact-e2e.spec.ts:96` |
| 1 | writes real messages between two accounts; set KATCHUP_UI_LIFECYCLE=true | `tests/e2e/katchup/katchup-two-session.spec.ts:54` |
| 1 | sends a real message between two accounts; set KATCHUP_UI_LIFECYCLE=true | `tests/e2e/katchup/katchup-unread-badge-refresh.spec.ts:39` |
| 1 | chromium reading the clipboard needs a permission Playwright grants only in Chromium (Chromium-only by design) | `tests/e2e/kmail/kmail-actions-e2e.spec.ts:161` |
| 1 | uploads a file and sends a real mail; set KMAIL_UI_LIFECYCLE=true | `tests/e2e/kmail/kmail-attach-send-e2e.spec.ts:32` |
| 1 | (no reason string) process.env.KATCHUP_UI_LIFECYCLE !== 'true', 'needs the 2nd account (auth2.setup | `tests/e2e/kmail/kmail-browse-e2e.spec.ts:185` |
| 1 | changes KMail settings; set SETTINGS_UI_LIFECYCLE=true | `tests/e2e/kmail/kmail-settings-e2e.spec.ts:29` |
| 1 | needs auth2.setup.ts to log STORAGE_STATE_2 in as a real 2nd account; set KATCHUP_UI_LIFECYCLE=true | `tests/e2e/kmail/kmail-stored-xss-render.spec.ts:55` |
| 1 | measures real page loads on the shared server; set PERF_SINGLE_USER=true | `tests/e2e/platform/performance-single-user.spec.ts:43` |
| 1 | visual regression is opt-in: run `npm run ui:visual:update` to baseline, then `npm run ui:visual` | `tests/e2e/platform/visual.spec.ts:25` |
| 1 | writes a profile record; set PROFILE_UI_LIFECYCLE=true | `tests/e2e/profile/profile-actions.spec.ts:63` |
| 1 | the mobile field is read-only in this editor by design — a verified number changes through its own OTP flow, not this form | `tests/e2e/profile/profile-functional.spec.ts:237` |
| 1 | qa.business needs the BUSINESS_S session (BUSINESS_UI_LIFECYCLE=true, QA_BUSINESS_S_KPOST_ID) | `tests/e2e/sanity/sanity-screens.spec.ts:106` |
| 1 | writes real company registration details; set BUSINESS_UI_LIFECYCLE=true | `tests/e2e/settings/settings-business-company-details.spec.ts:36` |
| 1 | toggles a real privacy setting; set SETTINGS_UI_LIFECYCLE=true | `tests/e2e/settings/settings-digital-card.spec.ts:19` |
| 1 | toggles a real preference; set SETTINGS_UI_LIFECYCLE=true | `tests/e2e/settings/settings-functional.spec.ts:65` |
| 1 | uploads/removes a real cover image; set SETTINGS_UI_LIFECYCLE=true | `tests/e2e/settings/settings-profile-creation.spec.ts:24` |
| 1 | adds a real Instant Reply; set SETTINGS_UI_LIFECYCLE=true | `tests/e2e/settings/settings-security.spec.ts:28` |
| 1 | changes a real (cosmetic) preference; set SETTINGS_UI_LIFECYCLE=true | `tests/e2e/settings/settings-theme.spec.ts:22` |
| 1 | creates a real diary schedule; set KDIARY_UI_LIFECYCLE=true | `tests/e2e/verticals/kdiary-e2e.spec.ts:28` |
| 1 | creates and deletes a real document; set KOS_UI_LIFECYCLE=true | `tests/e2e/verticals/kword.spec.ts:72` |
| 1 | manual probe — set CLEANUP_PLAN=true to list orphaned QA records on the primary account, CLEANUP_EXECUTE=true to delete them | `tests/framework/_cleanup-orphaned-records.local.spec.ts:16` |

## Live condition — the application had nothing to test this run (117)

| Sites | Reason | Where |
| ----: | ------ | ----- |
| 15 | the Contacts panel was not showing right now (a session or load condition, not a Contacts defect) — see support/contacts.ts | `tests/e2e/contacts/contacts-accessibility.spec.ts:116`, `tests/e2e/contacts/contacts-accessibility.spec.ts:130`, `tests/e2e/contacts/contacts-accessibility.spec.ts:146`, `tests/e2e/contacts/contacts-functional.spec.ts:54` +11 more |
| 10 | already-exists the random mobile happened to collide — re-run | `tests/e2e/auth/signup-business-medium-large.spec.ts:208`, `tests/e2e/auth/signup-business.spec.ts:169`, `tests/e2e/auth/signup-login-accessibility.spec.ts:231`, `tests/e2e/auth/signup-login-accessibility.spec.ts:261` +6 more |
| 10 | invalid the OTP bypass code was rejected this run — re-run | `tests/e2e/auth/signup-business-medium-large.spec.ts:210`, `tests/e2e/auth/signup-business.spec.ts:171`, `tests/e2e/auth/signup-login-accessibility.spec.ts:233`, `tests/e2e/auth/signup-login-accessibility.spec.ts:263` +6 more |
| 3 | invalid the OTP bypass code was rejected this run — likely transient; re-run | `tests/e2e/auth/signup-business-medium-large.spec.ts:87`, `tests/e2e/auth/signup-business.spec.ts:378`, `tests/e2e/auth/signup-mobile-lifecycle.spec.ts:61` |
| 3 | already-exists the randomly generated mobile number happened to already be registered — vanishingly rare; re-run | `tests/e2e/auth/signup-validation.spec.ts:78`, `tests/e2e/auth/signup-validation.spec.ts:166`, `tests/e2e/auth/signup-validation.spec.ts:211` |
| 3 | invalid the OTP box rejected the bypass code this run — see enterMobileOtp's own doc comment; re-run | `tests/e2e/auth/signup-validation.spec.ts:83`, `tests/e2e/auth/signup-validation.spec.ts:171`, `tests/e2e/auth/signup-validation.spec.ts:216` |
| 2 | the QA company name could not be read right now; not invented | `tests/api/admin/latency.spec.ts:299`, `tests/api/admin/role-posting-lifecycle.spec.ts:622` |
| 2 | needs the mail sent by the first step | `tests/api/kmail/workflow-db.spec.ts:130`, `tests/api/kmail/workflow-db.spec.ts:162` |
| 2 | needs the sent message from the first step | `tests/api/kpost/katchup/workflow-db.spec.ts:118`, `tests/api/kpost/katchup/workflow-db.spec.ts:210` |
| 2 | already-exists the randomly generated mobile number happened to already be registered — re-run | `tests/e2e/auth/signup-kpostid-length-validation.spec.ts:44`, `tests/e2e/auth/signup-pincode-validation.spec.ts:48` |
| 2 | invalid the OTP box rejected the bypass code this run — see enterMobileOtp's doc comment; re-run | `tests/e2e/auth/signup-kpostid-length-validation.spec.ts:49`, `tests/e2e/auth/signup-pincode-validation.spec.ts:53` |
| 2 | the fixed probe id was not accepted right now — step 2 was not shown | `tests/e2e/auth/signup-login-accessibility.spec.ts:163`, `tests/e2e/auth/signup-login-screens.spec.ts:143` |
| 2 | the fixed probe id was not accepted right now — the password step (and its Forgot Password link) was not shown | `tests/e2e/auth/signup-login-accessibility.spec.ts:184`, `tests/e2e/auth/signup-login-screens.spec.ts:177` |
| 2 | taken the generated local part happened to collide — re-run | `tests/e2e/auth/signup-login-api-handling.spec.ts:149`, `tests/e2e/auth/signup-validation.spec.ts:238` |
| 2 | the new group was not listed in Katchup right now (four reloads) | `tests/e2e/group/group-info.spec.ts:238`, `tests/e2e/group/group-post-targeting.spec.ts:56` |
| 2 | the Basic Information editor was not showing right now (session or load condition; path verified live 2026-10-11) | `tests/e2e/profile/profile-functional.spec.ts:100`, `tests/e2e/profile/profile-functional.spec.ts:223` |
| 2 | the Instant Reply editor was not showing right now (session or load condition; path verified live 2026-10-11) | `tests/e2e/settings/settings-functional.spec.ts:169`, `tests/e2e/settings/settings-security.spec.ts:67` |
| 1 | the QA company's name could not be read right now — not invented; set up a role posting or company name first | `tests/api/admin/role-posting-lifecycle.spec.ts:187` |
| 1 | the probe location was not created (HTTP … …) | `tests/api/admin/security-cross-tenant-reads.spec.ts:87` |
| 1 | no transaction row was created to attack | `tests/api/kmail/mutation-idor.spec.ts:77` |
| 1 | no letterhead is available on this account to set | `tests/api/kmail/signature-letterhead-workflow.spec.ts:209` |
| 1 | no real marker available on this account right now (empty recent-activity window) | `tests/api/kpost/dashboard/feature.spec.ts:117` |
| 1 | no city returned for "chennai" right now — cannot chain the search | `tests/api/kpost/kbooking/feature.spec.ts:64` |
| 1 | no reachable destination returned for this source city right now | `tests/api/kpost/kbooking/feature.spec.ts:79` |
| 1 | no trips running on the first six real routes 14 days out right now — nothing to chain tripdetails to | `tests/api/kpost/kbooking/feature.spec.ts:101` |
| 1 | the trip lists no boarding point right now — nothing to look up | `tests/api/kpost/kbooking/feature.spec.ts:139` |
| 1 | no deactivated accounts on this target to check against | `tests/api/kpost/profile/directory-lookup.spec.ts:227` |
| 1 | no route answered the outsider right now (timeouts) — the IDOR question was not checked this run | `tests/api/kpost/security/katchup-attachment-idor.spec.ts:141` |
| 1 | image upload failed (replied …) | `tests/api/kpost/security/katchup-idor-regression-2026-10-03.spec.ts:361` |
| 1 | could not read back a real …; nothing to attack | `tests/api/kpost/security/profile-record-object-authorization.spec.ts:105` |
| 1 | already-exists … was reported as already registered — set a fresh … | `tests/e2e/auth/signup-business-medium-large.spec.ts:81` |
| 1 | taken "…" is already registered — set a fresh … | `tests/e2e/auth/signup-business-medium-large.spec.ts:132` |
| 1 | taken "…" is already taken — set a fresh … | `tests/e2e/auth/signup-business-medium-large.spec.ts:136` |
| 1 | taken ….… is taken — set a fresh … | `tests/e2e/auth/signup-business-medium-large.spec.ts:143` |
| 1 | taken the generated company name happened to collide — re-run | `tests/e2e/auth/signup-business-medium-large.spec.ts:242` |
| 1 | taken the generated unique name happened to collide — re-run | `tests/e2e/auth/signup-business-medium-large.spec.ts:246` |
| 1 | taken the generated KPOST ID happened to collide — re-run | `tests/e2e/auth/signup-business-medium-large.spec.ts:253` |
| 1 | taken the generated id collided — re-run | `tests/e2e/auth/signup-business.spec.ts:298` |
| 1 | every spare QA account is already a contact right now — nothing new to add | `tests/e2e/contacts/contacts-functional.spec.ts:224` |
| 1 | the directory search returned no Qatest… Bench right now — cannot drive add | `tests/e2e/contacts/contacts-functional.spec.ts:251` |
| 1 | the Contacts panel was not showing right now (session or load condition) | `tests/e2e/cross-layer/cross-layer-flows.spec.ts:283` |
| 1 | the new group was not listed in Katchup right now — a list condition | `tests/e2e/group/group-exit-e2e.spec.ts:75` |
| 1 | the new group was not listed in Katchup right now (four reloads) — a list or session condition, not a Group Info defect | `tests/e2e/group/group-info.spec.ts:62` |
| 1 | the new group is absent from Katchup right now (four reloads) | `tests/e2e/group/group-member-profile-session.spec.ts:82` |
| 1 | this account has no message history to click into — nothing to test | `tests/e2e/home/home-functional.spec.ts:179` |
| 1 | the name-capture modal was not showing right now (the crash-safety test above covers the failure mode) | `tests/e2e/kall/global-kool-kall.spec.ts:60` |
| 1 | no chat-header avatar rendered right now (header still loading) — nothing to click | `tests/e2e/katchup/chat-avatar-session.spec.ts:76` |
| 1 | the second contact (…) is not in this account's Recents right now — nothing to switch to | `tests/e2e/katchup/katchup-draft-persistence.spec.ts:72` |
| 1 | no contact matching "…" is in this account's address book right now — nothing to forward to | `tests/e2e/katchup/katchup-forward-subflow-e2e.spec.ts:115` |
| 1 | Select All only picked … messages here — need 6+, nothing to test right now | `tests/e2e/katchup/katchup-multi-forward-e2e.spec.ts:225` |
| 1 | no contact matching "Qatest3" is in this account\'s address book right now — nothing to transfer to | `tests/e2e/katchup/katchup-transfer-subflow-e2e.spec.ts:92` |
| 1 | qatest1 has no outside-domain contacts on this account to open | `tests/e2e/kmail/kmail-browse-e2e.spec.ts:361` |
| 1 | the header offers no language other than English right now | `tests/e2e/platform/i18n-switch.spec.ts:81` |
| 1 | the Contact Information editor was not showing right now (session or load condition; path verified live 2026-10-11) | `tests/e2e/profile/profile-functional.spec.ts:180` |
| 1 | the Education/School form was not showing right now (session or load condition; path verified live 2026-10-11) | `tests/e2e/profile/profile-functional.spec.ts:284` |
| 1 | the Experience form was not showing right now (session or load condition; path verified live 2026-10-11) | `tests/e2e/profile/profile-functional.spec.ts:310` |
| 1 | the About editor was not showing right now (session or load condition; path verified live 2026-10-11) | `tests/e2e/profile/profile-functional.spec.ts:335` |
| 1 | no plan rows are reachable from the Data Storage panel right now (radios and Buy open nothing) — the plan modal is covered on /kcloud | `tests/e2e/settings/settings-data-storage.spec.ts:92` |
| 1 | the Notification settings panel was not showing right now (session or load condition; path verified live 2026-10-11) | `tests/e2e/settings/settings-functional.spec.ts:99` |
| 1 | no member mobile number was listed on the page right now — nothing to collide with | `tests/e2e/user-management/usermanagement.spec.ts:97` |
| 1 | no merchants returned right now — nothing to click through | `tests/e2e/verticals/ecommerce.spec.ts:72` |
| 1 | the directory search returned no entry for "…" (… / India / English) right now — set KDIRECTORY_SEARCH_TERM to a listed name | `tests/e2e/verticals/kdirectory-launch.spec.ts:103` |
| 1 | no article loaded to share (live feed may be empty right now) | `tests/e2e/verticals/knews.spec.ts:134` |
| 1 | the QA company has no workplace tier values on this account to place a location under | `tests/e2e-admin/admin-setup/workplace-location-setup.spec.ts:79` |
| 1 | no employee was available to pick on the … tab | `tests/e2e-admin/human-resources/admin-employee-management-pii.spec.ts:54` |
| 1 | Submit button was not available on this tab right now (admin role gating) | `tests/e2e-admin/screens/admin-dead-screens.spec.ts:65` |
| 1 | "Menu Privilege" nav link was not available right now (admin role gating) | `tests/e2e-admin/screens/admin-dead-screens.spec.ts:110` |
| 1 | "Postal Code Library" nav link was not available right now (admin role gating) | `tests/e2e-admin/screens/admin-dead-screens.spec.ts:137` |

## No reason string — classified from the condition only; Phase 1 gives each one a reason (0)

_None._

## Unclassified — must be 0 (the build fails otherwise) (0)

_None._

