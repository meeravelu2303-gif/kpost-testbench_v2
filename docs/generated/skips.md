# Skip ledger — every skip reason in the suite, classified

**GENERATED — do not edit.** Written by `tests/framework/skip-ledger.spec.ts`
(`npm run framework`). Edit the specs, not this file.

A skip is honest only when its reason says what kind of skip it is. Five classes a skip may
be in, one it should not stay in (no reason string), and one that fails the build (unclassified).

| Class | Sites | Spec files |
| ----- | ----: | ---------: |
| Retune | 0 | 0 |
| Blocked by a defect | 48 | 27 |
| Provision | 351 | 249 |
| Owner decision | 218 | 158 |
| Live condition | 118 | 56 |
| No reason string | 0 | 0 |
| Unclassified | 0 | 0 |
| **Total** | **735** | **295** |

## The last run, by the engine’s own skip classes

Run `run-a2e15e9f-48f8-4cff-b686-8b8edd757bbe` at 2026-10-30T11:29:08.370Z: 2616 checks, 1051 applicable ran (96.7% passed), 1565 skipped:

| Engine skip class | Checks | Meaning |
| ----------------- | -----: | ------- |
| notApplicable | 1483 | the validator does not apply to that endpoint (by design) |
| recoverable | 0 | needs a fixture, an id or a second principal — a gap to close |
| blockedByDefect | 21 | an open defect stops the check from being meaningful |
| deliberate | 0 | an owner pause or a safety choice |
| environmental | 61 | host or transport trouble this run |

## Retune — a selector that no longer matches, or a defect; Phase 1 drives this to 0 (0)

_None._

## Blocked by a defect — an open bug stops the check from meaning anything (48)

| Sites | Reason | Where |
| ----: | ------ | ----- |
| 3 | scheduledKall did not return a kallID (status …) | `tests/kpost-api/security/kall-legacy-writes-regression-2026-10-07.spec.ts:38`, `tests/kpost-api/security/kall-legacy-writes-regression-2026-10-07.spec.ts:87`, `tests/kpost-api/security/kall-legacy-writes-regression-2026-10-07.spec.ts:133` |
| 3 | kall-initiate did not return a kallID to attack (placed replied …) | `tests/kpost-api/security/kall-object-authorization.spec.ts:57`, `tests/kpost-api/security/kall-object-authorization.spec.ts:152`, `tests/kpost-api/security/kall-object-authorization.spec.ts:415` |
| 3 | sendMessage did not return a msgID (status …) | `tests/kpost-api/security/katchup-cross-account-idor-2026-10-12.spec.ts:51`, `tests/kpost-api/security/katchup-cross-account-idor-2026-10-12.spec.ts:112`, `tests/kpost-api/security/katchup-legacy-recall-regression-2026-10-07.spec.ts:40` |
| 3 | send did not return a msgID (replied …) | `tests/kpost-api/security/katchup-idor-regression-2026-10-03.spec.ts:44`, `tests/kpost-api/security/katchup-idor-regression-2026-10-03.spec.ts:169`, `tests/kpost-api/security/katchup-idor-regression-2026-10-03.spec.ts:253` |
| 3 | group-create did not return a groupKpostID (replied …) | `tests/kpost-api/security/katchup-idor-regression-2026-10-03.spec.ts:329`, `tests/kpost-api/security/katchup-idor-regression-2026-10-03.spec.ts:426`, `tests/kpost-api/security/katchup-object-authorization.spec.ts:224` |
| 2 | kmail-post-mail did not return a kmailID (…) | `tests/kmail-api/security/content-idor.spec.ts:64`, `tests/kmail-api/security/copies-info-idor.spec.ts:67` |
| 2 | BLOCKED: needs the msgID from "a message sends" | `tests/kpost-api/katchup/lifecycle.spec.ts:101`, `tests/kpost-api/katchup/lifecycle.spec.ts:112` |
| 2 | BLOCKED: needs the message from "send" | `tests/kpost-api/katchup/workflow-db.spec.ts:94`, `tests/kpost-api/katchup/workflow-db.spec.ts:168` |
| 2 | sendMessage did not return a msgID to attack (send replied …) — activates automatically once one is issued | `tests/kpost-api/security/katchup-object-authorization.spec.ts:50`, `tests/kpost-api/security/katchup-object-authorization.spec.ts:122` |
| 1 | BLOCKED: needs the record from "1 create" | `tests/framework/run-continuity.spec.ts:100` |
| 1 | BLOCKED: needs never the record from a step that failed | `tests/framework/run-continuity.spec.ts:102` |
| 1 | API open call returns an empty record (kmailID 0) — the intermittent empty-record fault #1348, seen in the browser too on 2026-10-22; parked until it is fixed | `tests/kmail-api/flows/mail-semantics-workflow.spec.ts:218` |
| 1 | Dev-confirmed 2026-09-26: this route is not in use — intentionally unavailable on this build, not a deployment gap. testkmail answers a plain Spring 404 "Not Found" for POST /draft/draftMailMultiPart, consistent with that. Not exercised, by design. | `tests/kmail-api/flows/manage-workflow.spec.ts:204` |
| 1 | Dev-confirmed 2026-09-26: letterhead id "1" IS the shared system default — "other[s] are should be added by user for their own customization." This matches the evidence already on file (getLetterHead marks id 1 `"default":"Y"` at a generic S3 path). So deleting id 1 is confirmed unsafe, exactly as suspected — not a remaining open question. What blocks a live test now is narrower: the KMail OpenAPI contract and workbook register only get-all/get-current/get-template/set-active-by-id/delete-by-id for letterheads — no create/save/upload route a user would call to add their own, so this bench has no way to create a personal letterhead to safely delete instead. Needs the dev to name which endpoint the "add your own" flow actually calls (not documented in the KMAILAPI workbook) before this can be tested end to end; not worked around by deleting the shared default. | `tests/kmail-api/flows/manage-workflow.spec.ts:288` |
| 1 | Dev-confirmed 2026-09-26: this route is not in use — intentionally unavailable on this build, not a deployment gap. Consistent with the plain Spring 404 "route not mapped" it returns. Not exercised, by design. | `tests/kmail-api/flows/manage-workflow.spec.ts:315` |
| 1 | unOpenedMailCountBySenderID is currently 500 for every account | `tests/kmail-api/flows/reads-workflow.spec.ts:103` |
| 1 | BLOCKED: needs the mail from "send" | `tests/kmail-api/flows/workflow-db.spec.ts:103` |
| 1 | BLOCKED: needs the mail and its transaction row from "send" | `tests/kmail-api/flows/workflow-db.spec.ts:134` |
| 1 | kmail-post-mail did not return a kmailID to attack (send replied …) | `tests/kmail-api/security/mutation-idor.spec.ts:57` |
| 1 | also blocked on #499 (kos-create-doc does not return a docId) independent of deferral | `tests/kpost-api/concurrency/scenarios.spec.ts:173` |
| 1 | katchup-send-multipart is the OLD direct-upload path — owner-confirmed 2026-09-26 that the current client uses the presigned-URL flow instead (aws-katchup-presigned + a direct S3 PUT + katchup-send-message's own uuid field). The route stays registered (generic validator sweep still runs against it) but its attachment-storage behaviour is no longer product- relevant, so it is not asserted on live. The prior finding is closed as #614 WONTFIX, not chased further. See presigned-attachment-workflow.spec.ts for the current, real upload path. | `tests/kpost-api/katchup/attachment-workflow.spec.ts:12` |
| 1 | deactivateAccount is sideEffect:'global' AND otpDependent:'requires' — doubly blocked on live. Disabling the QA account mid-suite would take every other test down with it. Never run for real; only the off-live negative probes touch it. | `tests/kpost-api/profile/device-workflow.spec.ts:107` |
| 1 | kall-scheduled did not return a kallID to attack (scheduled replied …) | `tests/kpost-api/security/kall-object-authorization.spec.ts:286` |
| 1 | send did not return a sharedMessageId (replied …) | `tests/kpost-api/security/katchup-idor-regression-2026-10-03.spec.ts:104` |
| 1 | the group send did not return a msgID (replied …) | `tests/kpost-api/security/katchup-object-authorization.spec.ts:246` |
| 1 | createEvent did not return a usable eventID; cannot continue | `tests/kpost-api/security/kdiary-object-authorization.spec.ts:54` |
| 1 | blocked by Bugzilla #499 (kword/create 500) — activates automatically once a docId is issued (create replied …) | `tests/kpost-api/security/kword-object-authorization.spec.ts:58` |
| 1 | … is genuinely already registered — set a fresh QA_SIGNUP_UI_MOBILE the signup screen's mobile Verify step is broken (a repeat of #720): it misreports this free number as taken, so the OTP modal never opens | `tests/kpost-ui/auth/signup-login-lifecycle.spec.ts:75` |
| 1 | invalid the OTP box just rejected the bypass code — likely test-infra noise (rate-limiting from concurrent heavy traffic on this host, see #721/INVALID), not a real defect; re-run once no other suite is hitting the same API host | `tests/kpost-ui/auth/signup-login-lifecycle.spec.ts:87` |
| 1 | the message did not send (see Katchup send defects) — edit state not reachable | `tests/kpost-ui/katchup/katchup-functional.spec.ts:139` |
| 1 | blocked by #1343 — group thread older-page request 500s on open | `tests/kpost-ui/katchup/katchup-group-receipts-e2e.spec.ts:89` |
| 1 | /writemail rendered the error boundary ("Something went wrong") — #990-shaped crash, reported by screens-batch4, not a compose finding | `tests/kpost-ui/kmail/kmail-compose.spec.ts:16` |
| 1 | /writemail rendered the error boundary ("Something went wrong") — #990-shaped crash, reported by screens-batch4, not a composer-control finding | `tests/kpost-ui/kmail/kmail-composer-controls.spec.ts:30` |
| 1 | /writemail rendered the error boundary ("Something went wrong") — #990-shaped crash, reported by screens-batch4, not a compose-fuzz finding | `tests/kpost-ui/kmail/kmail-security.spec.ts:58` |

## Provision — an account, connection, host or secret this machine lacks (351)

| Sites | Reason | Where |
| ----: | ------ | ----- |
| 86 | qa.bench needs a real live account (QA_KPOST_ID) | `tests/kpost-ui/auth/login-session.spec.ts:14`, `tests/kpost-ui/auth/login-session.spec.ts:80`, `tests/kpost-ui/auth/login-token-security.spec.ts:16`, `tests/kpost-ui/auth/login-token-security.spec.ts:91` +82 more |
| 33 | needs the KPOST_QA connection | `tests/framework/_diff-accounts.local.spec.ts:23`, `tests/framework/_snapshot-accounts.local.spec.ts:22`, `tests/kmail-api/flows/workflow-db.spec.ts:105`, `tests/kmail-api/flows/workflow-db.spec.ts:136` +29 more |
| 25 | qa.bench needs both QA accounts | `tests/kpost-ui/contacts/contacts.spec.ts:61`, `tests/kpost-ui/cross-layer/cross-layer-flows.spec.ts:47`, `tests/kpost-ui/group/group-exit-e2e.spec.ts:95`, `tests/kpost-ui/group/group-security.spec.ts:18` +21 more |
| 19 | (no reason string) kmailAuthGate() !== undefined, kmailAuthGate() ?? '' | `tests/kmail-api/contract.spec.ts:8`, `tests/kmail-api/engine/coverage.spec.ts:16`, `tests/kmail-api/engine/read.spec.ts:12`, `tests/kmail-api/flows/attachment-integrity.spec.ts:29` +15 more |
| 11 | needs the KPOST_QA connection to judge by the row | `tests/kmail-api/security/mutation-idor.spec.ts:36`, `tests/kpost-api/security/group-object-authorization.spec.ts:250`, `tests/kpost-api/security/group-object-authorization.spec.ts:464`, `tests/kpost-api/security/group-object-authorization.spec.ts:552` +7 more |
| 9 | account registry says which role is missing (requireAll) | `tests/kmail-api/flows/workflow-db.spec.ts:36`, `tests/kpost-api/contacts/contacts-workflow.spec.ts:21`, `tests/kpost-api/contacts/contacts-workflow.spec.ts:159`, `tests/kpost-api/profile/profile-workflow.spec.ts:19` +5 more |
| 9 | qa.bench needs both QA accounts (QA_KPOST_ID, QA_VICTIM_KPOST_ID) | `tests/kpost-ui/contacts/contacts.spec.ts:10`, `tests/kpost-ui/katchup/katchup-actions-more.spec.ts:34`, `tests/kpost-ui/katchup/katchup-actions.spec.ts:23`, `tests/kpost-ui/katchup/katchup-compose.spec.ts:31` +5 more |
| 8 | qa.business needs the BUSINESS_S account (QA_BUSINESS_S_KPOST_ID) | `tests/kpost-ui/platform/screens-business.spec.ts:21`, `tests/kpost-ui/settings/settings-business-bank-details.spec.ts:19`, `tests/kpost-ui/settings/settings-business-company-details.spec.ts:20`, `tests/kpost-ui/user-management/usermanagement-accessibility.spec.ts:32` +4 more |
| 6 | qa.business.m needs the BUSINESS_M account of the QA testing company (QA_BUSINESS_M_KPOST_ID) | `tests/admin-api/engine/endpoint-matrix.spec.ts:345`, `tests/admin-api/maintenance/qa-leftovers-cleanup.spec.ts:40`, `tests/admin-api/performance/latency.spec.ts:149`, `tests/admin-api/validation/field-rules-sweep.spec.ts:325` +2 more |
| 6 | qa.bench qa.bench needs both QA accounts (QA_KPOST_ID, QA_VICTIM_KPOST_ID) | `tests/kmail-api/flows/reply-forward-workflow.spec.ts:51`, `tests/kpost-api/katchup/unread-count-clears-on-read.spec.ts:36`, `tests/kpost-ui/katchup/katchup-received-actions.spec.ts:78`, `tests/kpost-ui/katchup/katchup-two-session.spec.ts:44` +2 more |
| 5 | qa.business.m needs the BUSINESS_M account (QA_BUSINESS_M_KPOST_ID + QA_BUSINESS_M_COMPANY_ID) | `tests/admin-api/flows/feature.spec.ts:63`, `tests/admin-api/flows/reads-workflow.spec.ts:16`, `tests/admin-api/security/cross-tenant-reads.spec.ts:16`, `tests/admin-api/security/probes.spec.ts:15` +1 more |
| 5 | needs the KPOST_QA connection to assert persistence | `tests/kmail-api/flows/workflow-db.spec.ts:44`, `tests/kpost-api/katchup/workflow-db.spec.ts:53`, `tests/kpost-api/katchup/workflow-db.spec.ts:92`, `tests/kpost-api/katchup/workflow-db.spec.ts:125` +1 more |
| 5 | needs two distinct KPost principals | `tests/kpost-api/security/kall-legacy-writes-regression-2026-10-07.spec.ts:19`, `tests/kpost-api/security/kall-object-authorization.spec.ts:519`, `tests/kpost-api/security/katchup-legacy-recall-regression-2026-10-07.spec.ts:19`, `tests/kpost-api/security/katchup-object-authorization.spec.ts:23` +1 more |
| 4 | qa.bench needs a real account (QA_KPOST_ID) | `tests/kpost-ui/platform/accessibility-axe.spec.ts:27`, `tests/kpost-ui/platform/keyboard-nav.spec.ts:19`, `tests/kpost-ui/platform/network-resilience.spec.ts:19`, `tests/kpost-ui/platform/visual.spec.ts:22` |
| 3 | not configured for this run: … | `tests/admin-api/smoke/admin-api.smoke.spec.ts:17`, `tests/kmail-api/smoke/kmail-api.smoke.spec.ts:15`, `tests/kpost-api/smoke/kpost-api.smoke.spec.ts:15` |
| 3 | needs provisioned qatest_* accounts | `tests/kmail-api/flows/workflow-db.spec.ts:42`, `tests/kmail-api/flows/workflow-db.spec.ts:101`, `tests/kmail-api/flows/workflow-db.spec.ts:131` |
| 3 | needs the primary account | `tests/kpost-api/profile/profile-workflow.spec.ts:54`, `tests/kpost-api/profile/profile-workflow.spec.ts:72`, `tests/kpost-api/profile/profile-workflow.spec.ts:117` |
| 3 | needs three distinct KPost principals | `tests/kpost-api/security/kall-object-authorization.spec.ts:26`, `tests/kpost-api/security/katchup-cross-account-idor-2026-10-12.spec.ts:35`, `tests/kpost-api/security/katchup-idor-regression-2026-10-03.spec.ts:20` |
| 3 | qa.bench qa.p3 needs the primary, 2nd and personal-3 QA accounts | `tests/kpost-ui/group/group-info.spec.ts:65`, `tests/kpost-ui/group/group-member-profile-session.spec.ts:28`, `tests/kpost-ui/group/group-post-targeting.spec.ts:25` |
| 3 | needs both QA accounts, qatest1 and qatest3 | `tests/kpost-ui/kmail/kmail-browse-e2e.spec.ts:28`, `tests/kpost-ui/kmail/kmail-phone-e2e.spec.ts:24`, `tests/kpost-ui/kmail/kmail-status-e2e.spec.ts:32` |
| 3 | needs the second QA account (QA_VICTIM_KPOST_ID) | `tests/kpost-ui/smoke/contacts.smoke.spec.ts:16`, `tests/kpost-ui/smoke/katchup.smoke.spec.ts:24`, `tests/kpost-ui/smoke/kmail.smoke.spec.ts:22` |
| 2 | qa.business.m needs the BUSINESS_M account of the QA testing company (QA_BUSINESS_M_KPOST_ID + QA_BUSINESS_M_COMPANY_ID) | `tests/admin-api/flows/role-posting-lifecycle.spec.ts:122`, `tests/admin-api/flows/role-posting-lifecycle.spec.ts:516` |
| 2 | needs the BUSINESS_S admin principal | `tests/kpost-api/security/admin-bank-company-cross-company.spec.ts:15`, `tests/kpost-api/security/admin-usermanagement-cross-company.spec.ts:15` |
| 2 | needs a real QA_BUSINESS_M_COMPANY_ID distinct from the attacker's own company | `tests/kpost-api/security/admin-bank-company-cross-company.spec.ts:17`, `tests/kpost-api/security/admin-usermanagement-cross-company.spec.ts:17` |
| 2 | needs the personal and personal-3 principals | `tests/kpost-api/security/kdiary-object-authorization.spec.ts:40`, `tests/kpost-api/security/profile-record-object-authorization.spec.ts:47` |
| 2 | needs QA_PASSWORD | `tests/kpost-api/signup-login/security-session.spec.ts:59`, `tests/kpost-api/signup-login/security-session.spec.ts:106` |
| 2 | no KPost principal configured | `tests/kpost-api/signup-login/security-session.spec.ts:68`, `tests/kpost-api/signup-login/security-session.spec.ts:109` |
| 2 | qa.bench needs a real live account | `tests/kpost-ui/kall/kall-features.spec.ts:106`, `tests/kpost-ui/profile/profile-actions.spec.ts:61` |
| 2 | needs the 2nd QA account (QA_VICTIM_KPOST_ID) | `tests/kpost-ui/kall/kall-validation.spec.ts:72`, `tests/kpost-ui/katchup/katchup-validation.spec.ts:18` |
| 2 | qa.bench needs a live QA account | `tests/kpost-ui/kmail/kmail-api-handling.spec.ts:16`, `tests/kpost-ui/platform/app-hardcoded-host.spec.ts:17` |
| 2 | needs a second QA account as the recipient | `tests/kpost-ui/kmail/kmail-composer-controls.spec.ts:257`, `tests/kpost-ui/kmail/kmail-composer-controls.spec.ts:299` |
| 2 | qa.bench needs a real QA account (QA_KPOST_ID) | `tests/kpost-ui/profile/profile-validation.spec.ts:29`, `tests/kpost-ui/settings/settings-validation.spec.ts:17` |
| 1 | roleEmployeeMobile roleEmployeeEmail needs the reserved QA test-employee identity in .env (QA_ROLE_EMPLOYEE_MOBILE + QA_ROLE_EMPLOYEE_EMAIL) | `tests/admin-api/flows/role-posting-lifecycle.spec.ts:118` |
| 1 | list delete maintenance only: set ADMIN_QA_CLEANUP=list (read-only) or ADMIN_QA_CLEANUP=delete | `tests/admin-api/maintenance/qa-leftovers-cleanup.spec.ts:36` |
| 1 | qa.business.m roleEmployeeMobile roleEmployeeEmail needs the QA company admin (QA_BUSINESS_M_*) and the QA employee identity (QA_ROLE_EMPLOYEE_*) | `tests/admin-api/maintenance/setup-staff-employee.spec.ts:31` |
| 1 | roleEmployeeMobile roleEmployeeEmail needs ADMIN_ROLE_POSTING_LIVE=true and the reserved QA employee identity (QA_ROLE_EMPLOYEE_MOBILE/EMAIL) | `tests/admin-api/performance/latency.spec.ts:272` |
| 1 | needs ADMIN_API_BASE_URL (the Admin test box) | `tests/admin-api/sanity/read-sweep.spec.ts:15` |
| 1 | needs both BUSINESS_M and BUSINESS_S principals | `tests/admin-api/security/cross-tenant-reads.spec.ts:15` |
| 1 | needs a configured admin host | `tests/admin-ui/auth/admin-login.spec.ts:11` |
| 1 | ADMIN_MONGO_URI is not configured (read-only) — needed to judge the Admin document | `tests/admin-ui/cross-layer/admin-cross-layer.spec.ts:58` |
| 1 | "Add From Application" tab not reachable with this account\'s role value | `tests/admin-ui/screens/admin-dead-screens.spec.ts:46` |
| 1 | an Admin connection has been configured | `tests/framework/admin-db-safety.spec.ts:69` |
| 1 | no finding supplied — pass --bug=<file.json> (see the usage block above) | `tests/framework/bug-tracker/manual-bug.spec.ts:125` |
| 1 | no local .env on this machine (fresh checkout / CI) | `tests/framework/env-template.spec.ts:62` |
| 1 | needs at least two configured accounts | `tests/framework/kmail-flags.spec.ts:128` |
| 1 | needs BUGZILLA_URL and BUGZILLA_API_KEY | `tests/framework/ownership.spec.ts:300` |
| 1 | no pre-run snapshot found — run _snapshot-accounts.local.spec.ts first | `tests/framework/_diff-accounts.local.spec.ts:24` |
| 1 | needs three QA accounts | `tests/kmail-api/flows/mail-semantics-workflow.spec.ts:46` |
| 1 | needs four distinct QA principals configured (QA_* accounts) | `tests/kmail-api/security/copies-info-idor.spec.ts:28` |
| 1 | needs the KPOST_QA connection to resolve the real membership id | `tests/kpost-api/group/feature.spec.ts:310` |
| 1 | needs the KPOST_QA database to see read_time | `tests/kpost-api/katchup/offline-delivery.spec.ts:76` |
| 1 | needs the KPOST_QA connection (DB_HOST/DB_NAME) to prove the account exists | `tests/kpost-api/profile/directory-lookup.spec.ts:20` |
| 1 | set QA_COMPANY_NAME to a real company name to unblock this | `tests/kpost-api/profile/feature.spec.ts:336` |
| 1 | needs the KPOST_QA database to pick the id and remove the account | `tests/kpost-api/profile/throwaway-account.spec.ts:63` |
| 1 | needs three KPost principals (personal-3..5) and the 2nd QA account (QA_VICTIM_KPOST_ID) | `tests/kpost-api/security/group-object-authorization.spec.ts:240` |
| 1 | qa.p5 needs a real QA_PERSONAL_5_KPOST_ID account not already in the attacker's contacts | `tests/kpost-api/security/kall-object-authorization.spec.ts:524` |
| 1 | needs a KPost principal | `tests/kpost-api/security/katchup-filter-messageby-leak-guard-2026-10-12.spec.ts:17` |
| 1 | needs the personal-5 and victim principals | `tests/kpost-api/security/katchup-object-authorization.spec.ts:180` |
| 1 | needs two distinct KPost principals (personal + personal-3) | `tests/kpost-api/security/object-authorization.spec.ts:23` |
| 1 | needs the shared QA password to act as a second account | `tests/kpost-api/security/object-authorization.spec.ts:24` |
| 1 | needs the KPOST_QA connection to judge by the row, not the reply | `tests/kpost-api/security/object-authorization.spec.ts:67` |
| 1 | the legacy reference account is absent from this target | `tests/kpost-api/signup-login/domain-policy.spec.ts:134` |
| 1 | set QA_NEG_KPOST_ID + QA_NEG_PASSWORD to a dedicated throwaway account so wrong-password attempts never lock the primary QATEST account | `tests/kpost-api/signup-login/login-flow.spec.ts:103` |
| 1 | no.such.user.9f2a@kpost.in set QA_FORGOT_PASSWORD_KPOST_ID to a spare account whose password may be rewritten; unset, this flow has no safe target | `tests/kpost-api/signup-login/otp-signup-lifecycle.spec.ts:385` |
| 1 | set QA_LOGIN_MISMATCH_MOBILE to a registered India mobile to exercise the country/number mismatch | `tests/kpost-ui/auth/login-country-mobile-mismatch.spec.ts:15` |
| 1 | no.such.user needs a real spare account — set QA_FORGOT_PASSWORD_KPOST_ID (never QA_KPOST_ID) | `tests/kpost-ui/auth/login-forgot-password-lifecycle.spec.ts:26` |
| 1 | needs the KPOST_QA database (DB_ENABLED) to read the OTP that was sent | `tests/kpost-ui/auth/login-forgot-password-lifecycle.spec.ts:47` |
| 1 | needs QA_KPOST_ID | `tests/kpost-ui/auth/login-functional.spec.ts:16` |
| 1 | qa.bench needs a real, known KPOST ID to reach the password step | `tests/kpost-ui/auth/login-submit-locks-inputs.spec.ts:12` |
| 1 | needs the KPOST_QA database (DB_ENABLED) to pick the id and remove it | `tests/kpost-ui/auth/sanity-signup.spec.ts:58` |
| 1 | already-exists … was reported as already registered — unexpected on the Business path per source, but handled defensively; set a fresh QA_SIGNUP_BUSINESS_UI_MOBILE | `tests/kpost-ui/auth/signup-business.spec.ts:318` |
| 1 | taken "…" is already registered — set a fresh QA_SIGNUP_BUSINESS_COMPANY_NAME | `tests/kpost-ui/auth/signup-business.spec.ts:350` |
| 1 | taken "…" is already taken — set a fresh QA_SIGNUP_BUSINESS_UNIQUE_NAME | `tests/kpost-ui/auth/signup-business.spec.ts:354` |
| 1 | taken ….… is taken — set a fresh QA_SIGNUP_BUSINESS_DESIGNATION_ID or QA_SIGNUP_BUSINESS_UNIQUE_NAME | `tests/kpost-ui/auth/signup-business.spec.ts:361` |
| 1 | taken … is taken under a different mobile than … — set a fresh QA_SIGNUP_UI_KPOST_ID_LOCAL | `tests/kpost-ui/auth/signup-login-lifecycle.spec.ts:107` |
| 1 | already-exists … is already registered — set a fresh QA_SIGNUP_MOBILE_VIEWPORT_UI_MOBILE | `tests/kpost-ui/auth/signup-mobile-lifecycle.spec.ts:46` |
| 1 | taken … is taken — set a fresh QA_SIGNUP_MOBILE_VIEWPORT_UI_KPOST_ID_LOCAL | `tests/kpost-ui/auth/signup-mobile-lifecycle.spec.ts:70` |
| 1 | qa.bench needs a real, already-registered live account (QA_KPOST_ID) as the known-taken value | `tests/kpost-ui/auth/signup-validation.spec.ts:245` |
| 1 | needs the primary and personal-4 QA accounts | `tests/kpost-ui/contacts/contacts-actions-e2e.spec.ts:81` |
| 1 | needs the 2nd QA account (QA_VICTIM_KPOST_ID) in the address book | `tests/kpost-ui/contacts/contacts-validation.spec.ts:45` |
| 1 | needs the KPOST_QA connection (DB_HOST/DB_NAME) for the database half | `tests/kpost-ui/cross-layer/cross-layer-login.spec.ts:35` |
| 1 | needs QA_PASSWORD to drive a real login | `tests/kpost-ui/cross-layer/cross-layer-login.spec.ts:39` |
| 1 | needs the 1st, 2nd, 3rd and 4th QA accounts | `tests/kpost-ui/group/group-admin-e2e.spec.ts:60` |
| 1 | qa.p4 needs a configured personal-4 account to add | `tests/kpost-ui/group/group-info.spec.ts:194` |
| 1 | needs the 2nd QA account | `tests/kpost-ui/group/group-validation.spec.ts:58` |
| 1 | needs the 1st, 2nd and 3rd QA accounts | `tests/kpost-ui/group/group-validation.spec.ts:99` |
| 1 | qa.bench needs both QA accounts (a group needs at least one other member) | `tests/kpost-ui/group/group.spec.ts:16` |
| 1 | qa.business needs the BUSINESS_S company admin account (QA_BUSINESS_S_KPOST_ID) | `tests/kpost-ui/journeys/business-admin.spec.ts:19` |
| 1 | the directory returned no one for QA_MOBILE_EXISTS right now (live condition) | `tests/kpost-ui/journeys/contacts.spec.ts:43` |
| 1 | needs the KPOST_QA database to pick the identity and remove it | `tests/kpost-ui/journeys/first-use.spec.ts:79` |
| 1 | qa.bench needs a real live account and a 2nd account to open a conversation with | `tests/kpost-ui/katchup/chat-avatar-session.spec.ts:25` |
| 1 | qa.victim needs the 2nd QA account (QA_VICTIM_KPOST_ID) to open a conversation with | `tests/kpost-ui/katchup/katchup-composer-controls.spec.ts:18` |
| 1 | qa.bench needs the second QA account (QA_VICTIM_KPOST_ID) | `tests/kpost-ui/katchup/katchup-continuous.spec.ts:22` |
| 1 | needs 3 QA accounts (QA_KPOST_ID, QA_VICTIM_KPOST_ID, QA_PERSONAL_3_KPOST_ID) | `tests/kpost-ui/katchup/katchup-copies.spec.ts:30` |
| 1 | qa.bench qa.p3 needs all three QA accounts (QA_KPOST_ID, QA_VICTIM_KPOST_ID, a configured personal-3 account) | `tests/kpost-ui/katchup/katchup-group-receipts-e2e.spec.ts:66` |
| 1 | qa.bench needs the primary QA account | `tests/kpost-ui/katchup/katchup-report-contact-e2e.spec.ts:17` |
| 1 | needs both QA accounts | `tests/kpost-ui/kmail/kmail-actions-e2e.spec.ts:25` |
| 1 | needs the three QA accounts | `tests/kpost-ui/kmail/kmail-features-e2e.spec.ts:34` |
| 1 | needs the qatest1 and qatest3 accounts | `tests/kpost-ui/kmail/kmail-more-actions-e2e.spec.ts:105` |
| 1 | needs the primary QA account | `tests/kpost-ui/kmail/kmail-settings-e2e.spec.ts:23` |
| 1 | needs the 3rd QA account (QA_PERSONAL_3_KPOST_ID) | `tests/kpost-ui/kmail/kmail-validation.spec.ts:51` |
| 1 | qa.bench the authenticated checks need a real live account (QA_KPOST_ID) | `tests/kpost-ui/platform/monitoring-smoke.spec.ts:50` |
| 1 | qa.bench needs a live, logged-in QA account | `tests/kpost-ui/platform/performance-single-user.spec.ts:31` |
| 1 | qa.bench needs a real QA account | `tests/kpost-ui/profile/profile-sections-save-e2e.spec.ts:167` |
| 1 | needs a real live account (QA_VICTIM_KPOST_ID) | `tests/kpost-ui/profile/profile-webview.spec.ts:39` |
| 1 | the Company Registration edit form was not showing right now (needs the BUSINESS_S session; path unverified since 2026-10-11) | `tests/kpost-ui/settings/settings-business-company-details.spec.ts:50` |
| 1 | qa.p5 needs the spare QA account (QA_PERSONAL_5_KPOST_ID) | `tests/kpost-ui/smoke/auth.smoke.spec.ts:18` |
| 1 | needs the group-creator QA account (personal-3) | `tests/kpost-ui/smoke/group.smoke.spec.ts:18` |
| 1 | needs the primary QA account (QA_KPOST_ID) | `tests/kpost-ui/verticals/kdiary-validation.spec.ts:71` |

## Owner decision — gated flows, pauses and safety choices (218)

| Sites | Reason | Where |
| ----: | ------ | ----- |
| 12 | the mobile OTP bypass code only validates on the confirmed OTP test gateway | `tests/kpost-ui/auth/signup-business-medium-large.spec.ts:20`, `tests/kpost-ui/auth/signup-business-medium-large.spec.ts:155`, `tests/kpost-ui/auth/signup-business.spec.ts:298`, `tests/kpost-ui/auth/signup-kpostid-length-validation.spec.ts:24` +8 more |
| 9 | writes real messages; set KATCHUP_UI_LIFECYCLE=true | `tests/kpost-ui/katchup/katchup-actions-more.spec.ts:30`, `tests/kpost-ui/katchup/katchup-actions.spec.ts:19`, `tests/kpost-ui/katchup/katchup-copies.spec.ts:26`, `tests/kpost-ui/katchup/katchup-forward-subflow-e2e.spec.ts:28` +5 more |
| 7 | (no reason string) process.env.CONCURRENCY_LIFECYCLE !== 'true', DEFERRED_REASON | `tests/kpost-api/concurrency/scenarios.spec.ts:36`, `tests/kpost-api/concurrency/scenarios.spec.ts:71`, `tests/kpost-api/concurrency/scenarios.spec.ts:172`, `tests/kpost-api/concurrency/scenarios.spec.ts:216` +3 more |
| 6 | sends real mails; set KMAIL_UI_LIFECYCLE=true | `tests/kpost-ui/kmail/kmail-actions-e2e.spec.ts:17`, `tests/kpost-ui/kmail/kmail-browse-e2e.spec.ts:24`, `tests/kpost-ui/kmail/kmail-features-e2e.spec.ts:26`, `tests/kpost-ui/kmail/kmail-more-actions-e2e.spec.ts:101` +2 more |
| 6 | needs the BUSINESS_S admin session; set BUSINESS_UI_LIFECYCLE=true | `tests/kpost-ui/platform/screens-business.spec.ts:17`, `tests/kpost-ui/settings/settings-business-bank-details.spec.ts:15`, `tests/kpost-ui/user-management/usermanagement-accessibility.spec.ts:28`, `tests/kpost-ui/user-management/usermanagement-security.spec.ts:20` +2 more |
| 5 | writes to the QA company; set ADMIN_LIFECYCLE=true | `tests/admin-api/engine/endpoint-matrix.spec.ts:341`, `tests/admin-api/performance/latency.spec.ts:145`, `tests/admin-api/validation/field-rules-sweep.spec.ts:321`, `tests/admin-api/validation/input-hardening.spec.ts:168` +1 more |
| 5 | (no reason string) process.env.SIGNUP_UI_LIFECYCLE !== 'true', 'drives the real signup screen (a mo | `tests/kpost-ui/auth/signup-business-medium-large.spec.ts:151`, `tests/kpost-ui/auth/signup-kpostid-length-validation.spec.ts:20`, `tests/kpost-ui/auth/signup-login-api-handling.spec.ts:23`, `tests/kpost-ui/auth/signup-pincode-validation.spec.ts:20` +1 more |
| 5 | creates and deletes a real group; set GROUP_UI_LIFECYCLE=true | `tests/kpost-ui/group/group-admin-e2e.spec.ts:56`, `tests/kpost-ui/group/group-info.spec.ts:61`, `tests/kpost-ui/group/group-member-profile-session.spec.ts:24`, `tests/kpost-ui/group/group-post-targeting.spec.ts:21` +1 more |
| 5 | sends a real mail; set KMAIL_UI_LIFECYCLE=true | `tests/kpost-ui/kmail/kmail-compose.spec.ts:64`, `tests/kpost-ui/kmail/kmail-read-receipt-e2e.spec.ts:85`, `tests/kpost-ui/kmail/kmail-security.spec.ts:18`, `tests/kpost-ui/kmail/kmail-stored-xss-render.spec.ts:21` +1 more |
| 4 | qa.business needs ADMIN_UI_LIFECYCLE=true, a configured admin host and BUSINESS_M account | `tests/admin-ui/human-resources/admin-employee-management-pii.spec.ts:14`, `tests/admin-ui/screens/admin-dead-screens.spec.ts:14`, `tests/admin-ui/screens/admin-screens.spec.ts:23`, `tests/admin-ui/screens/admin-subtabs-health.spec.ts:15` |
| 4 | needs auth2.setup.ts for the 2nd account; set KATCHUP_UI_LIFECYCLE=true | `tests/kpost-ui/kmail/kmail-actions-e2e.spec.ts:21`, `tests/kpost-ui/kmail/kmail-features-e2e.spec.ts:30`, `tests/kpost-ui/kmail/kmail-status-e2e.spec.ts:148`, `tests/kpost-ui/kmail/kmail-status-e2e.spec.ts:313` |
| 3 | uploads a real file to S3 and sends a real mail; set KMAIL_LIFECYCLE=true and AWS_LIFECYCLE=true | `tests/kmail-api/flows/attachment-integrity.spec.ts:30`, `tests/kmail-api/security/attachment-delete-idor.spec.ts:24`, `tests/kmail-api/security/attachment-idor.spec.ts:25` |
| 3 | sends a real mail; set KMAIL_LIFECYCLE=true | `tests/kmail-api/security/content-idor.spec.ts:24`, `tests/kmail-api/security/copies-info-idor.spec.ts:24`, `tests/kmail-api/security/mutation-idor.spec.ts:26` |
| 3 | uploads a real file to S3 and sends a real message; set KATCHUP_LIFECYCLE=true and AWS_LIFECYCLE=true | `tests/kpost-api/katchup/attachment-integrity.spec.ts:31`, `tests/kpost-api/katchup/presigned-attachment-workflow.spec.ts:18`, `tests/kpost-api/security/katchup-attachment-idor.spec.ts:26` |
| 3 | sends a real message; set KATCHUP_LIFECYCLE=true | `tests/kpost-api/security/katchup-cross-account-idor-2026-10-12.spec.ts:36`, `tests/kpost-api/security/katchup-legacy-recall-regression-2026-10-07.spec.ts:20`, `tests/kpost-api/security/katchup-object-authorization.spec.ts:24` |
| 3 | needs auth2.setup.ts to log the 2nd account in; set KATCHUP_UI_LIFECYCLE=true | `tests/kpost-ui/group/group-exit-e2e.spec.ts:91`, `tests/kpost-ui/kmail/kmail-read-receipt-e2e.spec.ts:89`, `tests/kpost-ui/kmail/kmail-two-session-e2e.spec.ts:22` |
| 3 | sends a real message; set KATCHUP_UI_LIFECYCLE=true | `tests/kpost-ui/katchup/katchup-compose.spec.ts:64`, `tests/kpost-ui/katchup/katchup-digitalcard-share-e2e.spec.ts:18`, `tests/kpost-ui/katchup/katchup-secret-message-e2e.spec.ts:13` |
| 3 | edits a profile field; set PROFILE_UI_LIFECYCLE=true | `tests/kpost-ui/profile/profile-edit.spec.ts:15`, `tests/kpost-ui/profile/profile-functional.spec.ts:47`, `tests/kpost-ui/profile/profile-security.spec.ts:17` |
| 2 | writes real org structure; set ADMIN_LIFECYCLE=true | `tests/admin-api/flows/feature.spec.ts:59`, `tests/admin-api/validation/write-fuzz-workflow.spec.ts:208` |
| 2 | creates real KPost (testingapi) + KSMACC accounts for the QA company; set ADMIN_LIFECYCLE=true and ADMIN_ROLE_POSTING_LIVE=true | `tests/admin-api/flows/role-posting-lifecycle.spec.ts:114`, `tests/admin-api/flows/role-posting-lifecycle.spec.ts:512` |
| 2 | only meaningful when TEST_ENV=production | `tests/framework/live-safety.spec.ts:513`, `tests/framework/live-safety.spec.ts:538` |
| 2 | writes a real message; set KATCHUP_LIFECYCLE=true to run (owner sign-off, flow doc Q4) | `tests/kpost-api/katchup/lifecycle.spec.ts:16`, `tests/kpost-api/katchup/workflow-db.spec.ts:21` |
| 2 | creates a real diary event; set KDIARY_LIFECYCLE=true | `tests/kpost-api/kdiary/kdiary-reads-workflow.spec.ts:26`, `tests/kpost-api/security/kdiary-object-authorization.spec.ts:36` |
| 2 | creates a real, permanent company; set SIGNUP_UI_LIFECYCLE=true | `tests/kpost-ui/auth/signup-business-medium-large.spec.ts:16`, `tests/kpost-ui/auth/signup-business.spec.ts:294` |
| 2 | drives a real mobile OTP to reach this step; set SIGNUP_UI_LIFECYCLE=true | `tests/kpost-ui/auth/signup-login-accessibility.spec.ts:203`, `tests/kpost-ui/auth/signup-login-accessibility.spec.ts:235` |
| 2 | creates a real account and sends a real mail-OTP/e-mail; set SIGNUP_UI_LIFECYCLE=true | `tests/kpost-ui/auth/signup-login-lifecycle.spec.ts:22`, `tests/kpost-ui/auth/signup-mobile-lifecycle.spec.ts:22` |
| 2 | creates a real group; set GROUP_UI_LIFECYCLE=true | `tests/kpost-ui/cross-layer/cross-layer-flows.spec.ts:269`, `tests/kpost-ui/group/group.spec.ts:12` |
| 2 | creates a real scheduled call; set KALL_UI_LIFECYCLE=true | `tests/kpost-ui/cross-layer/cross-layer-flows.spec.ts:405`, `tests/kpost-ui/kall/kall-features.spec.ts:102` |
| 1 | one-time setup: set ADMIN_CREATE_STAFF=true and ADMIN_ROLE_POSTING_LIVE=true | `tests/admin-api/maintenance/setup-staff-employee.spec.ts:27` |
| 1 | opt-in: this writes to Bugzilla — run `npm run bug:apply` after a product preview | `tests/framework/bug-tracker/apply-filing-plan.spec.ts:19` |
| 1 | manual probe — set CLEANUP_PLAN=true to list orphaned QA records on the primary account, CLEANUP_EXECUTE=true to delete them | `tests/framework/_cleanup-orphaned-records.local.spec.ts:14` |
| 1 | manual probe — set ACCOUNT_DIFF=true right after a deep write-fuzz run | `tests/framework/_diff-accounts.local.spec.ts:18` |
| 1 | manual probe — set ACCOUNT_DIFF=true right before a deep write-fuzz run | `tests/framework/_snapshot-accounts.local.spec.ts:17` |
| 1 | sends real mail; set KMAIL_LIFECYCLE=true | `tests/kmail-api/flows/feature.spec.ts:84` |
| 1 | sends real KMail between our accounts; set KMAIL_LIFECYCLE=true | `tests/kmail-api/flows/mail-semantics-workflow.spec.ts:42` |
| 1 | writes real KMail data; set KMAIL_LIFECYCLE=true | `tests/kmail-api/flows/manage-workflow.spec.ts:39` |
| 1 | sensitive: sends a password and returns the account's real mail-send credentials. The endpoint's own definition explicitly says NOT to drive it on live. Recorded as a deliberate gap, not a workaround. | `tests/kmail-api/flows/manage-workflow.spec.ts:305` |
| 1 | sends real KMail between our two accounts; set KMAIL_LIFECYCLE=true | `tests/kmail-api/flows/reply-forward-workflow.spec.ts:47` |
| 1 | writes real KMail settings; set KMAIL_LIFECYCLE=true | `tests/kmail-api/flows/signature-letterhead-workflow.spec.ts:34` |
| 1 | sends real mail on a LIVE mail server; set KMAIL_LIFECYCLE=true to run | `tests/kmail-api/flows/workflow-db.spec.ts:25` |
| 1 | PERMANENT on this environment (sideEffect:"global", refused by production-guard.ts) AND requires explicit authorization even on a future non-production environment, given it compares real credential material — see docs/generated/blocked-endpoints.md | `tests/kmail-api/security/credential-disclosure.spec.ts:28` |
| 1 | PERMANENT on this environment: addingUserByAdmin/createOrRemoveBackupAdmin/resetPassword/ terminateUser are all sideEffect:"global", which production-guard.ts refuses unconditionally on TEST_ENV=production — needs a non-production environment, not a flag (see docs/generated/blocked-endpoints.md) | `tests/kpost-api/admin/member-lifecycle.spec.ts:33` |
| 1 | S3 attachment lifecycle; set AWS_LIFECYCLE=true | `tests/kpost-api/aws/feature.spec.ts:41` |
| 1 | testingapi answers 404 "No matching endpoint for this request" for POST saveUnsubscriberDetails, live-verified 2026-09-24. Not run standalone (a 404 there reads  | `tests/kpost-api/common/common-gaps.spec.ts:17` |
| 1 | sideEffect:'global', never cleared for live under any flag — the endpoint's own definition warns a wrong value here is a production incident. Never run for real; the off-live negative probes are the only thing that touches it. | `tests/kpost-api/common/common-gaps.spec.ts:27` |
| 1 | all three need a COMPANY_ADMIN token and two are sideEffect:'global'. The endpoint definitions' own extensive documented investigation (company.api.ts) already traced downloadCompanyLogo's 500-for-every-caller to two candidates (a broken route, or a missing- logo 500-instead-of-404) and explicitly declined to resolve it by uploading a real logo on a token given for reference, "not something to do unasked." That stands unless the owner explicitly authorizes driving these live. | `tests/kpost-api/common/common-gaps.spec.ts:37` |
| 1 | the OTP flows are opened only with OTP_TEST_GATEWAY=true and TEST_DB_MODE=true | `tests/kpost-api/common/forgot-password-limited.spec.ts:12` |
| 1 | writes the block state; set CONTACTS_LIFECYCLE=true | `tests/kpost-api/contacts/contacts-lists-workflow.spec.ts:97` |
| 1 | writes to the address book; set CONTACTS_LIFECYCLE=true | `tests/kpost-api/contacts/feature.spec.ts:89` |
| 1 | creates real groups; set GROUP_LIFECYCLE=true | `tests/kpost-api/group/feature.spec.ts:110` |
| 1 | maintenance only; set QA_GROUP_CLEANUP=true | `tests/kpost-api/group/qa-ui-group-cleanup.spec.ts:28` |
| 1 | places real calls between the QA accounts; set KALL_LIFECYCLE=true | `tests/kpost-api/kall/call-states.spec.ts:118` |
| 1 | places/schedules real calls; set KALL_LIFECYCLE=true (owner sign-off, docs/modules/kall-flow.md §5) | `tests/kpost-api/kall/feature.spec.ts:58` |
| 1 | places a real call; set KALL_LIFECYCLE=true (owner sign-off, docs/modules/kall-flow.md §5) | `tests/kpost-api/kall/kall-reads-workflow.spec.ts:59` |
| 1 | schedules a real call; set KALL_LIFECYCLE=true (owner sign-off, docs/modules/kall-flow.md §5) | `tests/kpost-api/kall/kall-reads-workflow.spec.ts:156` |
| 1 | schedules a real repeating call; set KALL_LIFECYCLE=true (owner sign-off, docs/modules/kall-flow.md §5) | `tests/kpost-api/kall/kall-reads-workflow.spec.ts:216` |
| 1 | writes real messages; set KATCHUP_LIFECYCLE=true (owner sign-off, docs/modules/katchup-flow.md §6) | `tests/kpost-api/katchup/feature.spec.ts:182` |
| 1 | sends a real message between the QA accounts; set KATCHUP_LIFECYCLE=true | `tests/kpost-api/katchup/offline-delivery.spec.ts:64` |
| 1 | sends real messages between the QA accounts; set KATCHUP_LIFECYCLE=true | `tests/kpost-api/katchup/rules.spec.ts:92` |
| 1 | sends a real message to get an id to test with; set KATCHUP_LIFECYCLE=true | `tests/kpost-api/katchup/shared-reference-workflow.spec.ts:18` |
| 1 | sends a real message between our two accounts; set KATCHUP_LIFECYCLE=true (owner sign-off) | `tests/kpost-api/katchup/unread-count-clears-on-read.spec.ts:32` |
| 1 | real third-party seat hold, unconfirmed sandbox — needs explicit authorization | `tests/kpost-api/kbooking/feature.spec.ts:148` |
| 1 | writes real diary events; set KDIARY_LIFECYCLE=true | `tests/kpost-api/kdiary/feature.spec.ts:66` |
| 1 | creates a real diary event and report; set KDIARY_LIFECYCLE=true | `tests/kpost-api/kdiary/kdiary-reads-workflow.spec.ts:96` |
| 1 | writes real KWord docs; set KOS_LIFECYCLE=true | `tests/kpost-api/kos/feature.spec.ts:47` |
| 1 | metered AI calls; set KOS_AI_LIVE=true to run | `tests/kpost-api/kos/feature.spec.ts:176` |
| 1 | testingapi answers 404 "No matching endpoint for this request" for GET /kword/documents/ — the KWord list route is not deployed on this test build (see the endpoint definition's own  | `tests/kpost-api/kos/feature.spec.ts:277` |
| 1 | sendPrimaryDeviceOtp is otpDependent:'sends' with sideEffect:'external' — the SMS/OTP kill-switch in destructiveBlockReason() refuses it against any real host in every mode. Only a confirmed OTP test gateway (OTP_TEST_GATEWAY + TEST_DB_MODE, neither configured here) would open it. Not worked around: sending a real OTP on a normal run would cost money and exhaust the SMS gateway. | `tests/kpost-api/profile/device-workflow.spec.ts:16` |
| 1 | sendPrimaryOrSecondaryDeviceOtp is otpDependent:'sends' with sideEffect:'external' — same SMS/OTP kill-switch as sendPrimaryDeviceOtp above. | `tests/kpost-api/profile/device-workflow.spec.ts:28` |
| 1 | sendAccountDeactivationOtp is otpDependent:'sends' with sideEffect:'external' — same SMS/OTP kill-switch, and it is the OTP step of the account-deactivation flow, which stays blocked in its own right below regardless. | `tests/kpost-api/profile/device-workflow.spec.ts:37` |
| 1 | forgotPasswordOrKpostID is otpDependent:'sends' with sideEffect:'external' — a public (unauthenticated) recovery entry point that sends a real OTP; same kill-switch as the others above. | `tests/kpost-api/profile/device-workflow.spec.ts:47` |
| 1 | setDeviceAsPrimary is otpDependent:'requires' AND matches the guard's isSessionDestroyer pattern — blocked even when OTP_TEST_GATEWAY+TEST_DB_MODE are both set, specifically because it would displace the primary device of the account every other test in the suite is logged in as, breaking every later test in the run. Not worked around: there is no safe way to exercise this against the suite's own live session. | `tests/kpost-api/profile/device-workflow.spec.ts:57` |
| 1 | updateDeviceAsPrimary matches the same isSessionDestroyer pattern as setDeviceAsPrimary above, for the same reason. | `tests/kpost-api/profile/device-workflow.spec.ts:69` |
| 1 | setDeviceAsSecondary matches the isSessionDestroyer pattern (updateDeviceAs*/setDeviceAs*) for the same reason as the primary-device pair above. | `tests/kpost-api/profile/device-workflow.spec.ts:78` |
| 1 | updateDeviceAsSecondary matches the isSessionDestroyer pattern for the same reason as the others above. | `tests/kpost-api/profile/device-workflow.spec.ts:87` |
| 1 | changePassword is sideEffect:'global', never cleared for live under any flag. Running it would change the credential every other suite/test logs in with mid-run — a self-inflicted lockout, not a defect to find. The documented sample is also missing a distinct newPassword field from confirmPassword, which the null/required negative probes already exercise off-live. | `tests/kpost-api/profile/device-workflow.spec.ts:96` |
| 1 | writes real profile data; set PROFILE_LIFECYCLE=true to run | `tests/kpost-api/profile/feature.spec.ts:50` |
| 1 | runs only on a confirmed OTP test gateway: OTP_TEST_GATEWAY=true + TEST_DB_MODE=true | `tests/kpost-api/profile/throwaway-account.spec.ts:48` |
| 1 | the account is deleted from the test DB afterwards; set DB_ALLOW_WRITES=true | `tests/kpost-api/profile/throwaway-account.spec.ts:52` |
| 1 | writes a message; set KATCHUP_LIFECYCLE=true | `tests/kpost-api/security/cross-user-gaps.spec.ts:46` |
| 1 | presigns an S3 key; set AWS_LIFECYCLE=true | `tests/kpost-api/security/cross-user-gaps.spec.ts:150` |
| 1 | schedules a real call; set KALL_LIFECYCLE=true | `tests/kpost-api/security/kall-legacy-writes-regression-2026-10-07.spec.ts:20` |
| 1 | places a real call; set KALL_LIFECYCLE=true | `tests/kpost-api/security/kall-object-authorization.spec.ts:27` |
| 1 | sends real messages / creates real groups; set KATCHUP_LIFECYCLE=true | `tests/kpost-api/security/katchup-idor-regression-2026-10-03.spec.ts:21` |
| 1 | creates a real document; set KOS_LIFECYCLE=true | `tests/kpost-api/security/kword-object-authorization.spec.ts:23` |
| 1 | creates real profile records; set PROFILE_LIFECYCLE=true | `tests/kpost-api/security/profile-record-object-authorization.spec.ts:43` |
| 1 | changes account preferences; set SETTINGS_LIFECYCLE=true | `tests/kpost-api/settings/feature.spec.ts:33` |
| 1 | OTP flows run only on a confirmed test gateway: OTP_TEST_GATEWAY=true + TEST_DB_MODE=true | `tests/kpost-api/signup-login/otp-lifecycle-db.spec.ts:18` |
| 1 | needs a real 10-minute wait; set OTP_EXPIRY_WAIT=true to run the expiry boundary | `tests/kpost-api/signup-login/otp-lifecycle-db.spec.ts:366` |
| 1 | OTP/signup flows run only on a confirmed test gateway: OTP_TEST_GATEWAY=true + TEST_DB_MODE=true | `tests/kpost-api/signup-login/otp-signup-lifecycle.spec.ts:17` |
| 1 | mints a permanent company/tenant on the test DB; set BUSINESS_SIGNUP_LIVE=true to run it. Confirmed live 2026-10-02: registers QA Bench API Business Co end to end. | `tests/kpost-api/signup-login/otp-signup-lifecycle.spec.ts:241` |
| 1 | BLOCKED: the forgot-password sender sends a real SMS even on the test gateway; the one SMS a run may send belongs to the browser test | `tests/kpost-api/signup-login/otp-signup-lifecycle.spec.ts:400` |
| 1 | logs in and out repeatedly; set LOGIN_UI_LIFECYCLE=true | `tests/kpost-ui/auth/login-forgot-password-lifecycle.spec.ts:18` |
| 1 | sends ONE real SMS to the spare account; set FORGOT_PASSWORD_SMS=true (the run levels do) | `tests/kpost-ui/auth/login-forgot-password-lifecycle.spec.ts:22` |
| 1 | ends the session; set LOGIN_UI_LIFECYCLE=true | `tests/kpost-ui/auth/login-session.spec.ts:76` |
| 1 | logs the shared account out and invalidates the saved session; set SESSION_INVALIDATION_CHECK=true and run in isolation | `tests/kpost-ui/auth/login-token-security.spec.ts:87` |
| 1 | creates (and removes) a real account; set SIGNUP_UI_LIFECYCLE=true | `tests/kpost-ui/auth/sanity-signup.spec.ts:24` |
| 1 | the signup OTP is mocked only on the confirmed test gateway (OTP_TEST_GATEWAY + TEST_DB_MODE) | `tests/kpost-ui/auth/sanity-signup.spec.ts:28` |
| 1 | the account is removed from KPOST_QA afterwards; set DB_ALLOW_WRITES=true | `tests/kpost-ui/auth/sanity-signup.spec.ts:32` |
| 1 | needs the OTP test gateway; set OTP_TEST_GATEWAY=true TEST_DB_MODE=true | `tests/kpost-ui/auth/signup-business.spec.ts:114` |
| 1 | drives a real mobile OTP to reach these screens; set SIGNUP_UI_LIFECYCLE=true | `tests/kpost-ui/auth/signup-screens-post-otp.spec.ts:47` |
| 1 | changes real contacts; set CONTACTS_UI_LIFECYCLE=true | `tests/kpost-ui/contacts/contacts-actions-e2e.spec.ts:77` |
| 1 | adds a real contact; set CONTACTS_UI_LIFECYCLE=true | `tests/kpost-ui/contacts/contacts-functional.spec.ts:173` |
| 1 | blocks a real contact; set CONTACTS_UI_LIFECYCLE=true | `tests/kpost-ui/contacts/contacts.spec.ts:57` |
| 1 | sends real messages and mails; set KATCHUP_UI_LIFECYCLE=true and KMAIL_UI_LIFECYCLE=true | `tests/kpost-ui/cross-layer/cross-layer-flows.spec.ts:43` |
| 1 | creates real groups; set GROUP_UI_LIFECYCLE=true | `tests/kpost-ui/group/group-exit-e2e.spec.ts:87` |
| 1 | Recents shows a load-error state, not an empty state — out of scope for this test | `tests/kpost-ui/home/home-recents-search-empty-state.spec.ts:29` |
| 1 | drives real uploads + sends; set KATCHUP_UI_LIFECYCLE=true | `tests/kpost-ui/katchup/katchup-attach-repeat-e2e.spec.ts:23` |
| 1 | drives a real presigned upload + send; set KATCHUP_UI_LIFECYCLE=true | `tests/kpost-ui/katchup/katchup-attach-send-e2e.spec.ts:13` |
| 1 | sends real messages; set KATCHUP_UI_LIFECYCLE=true | `tests/kpost-ui/katchup/katchup-content-correctness.spec.ts:58` |
| 1 | writes real messages; set KATCHUP_UI_LIFECYCLE=true (npm run product:kpost-ui does) | `tests/kpost-ui/katchup/katchup-continuous.spec.ts:18` |
| 1 | types into a real composer; set KATCHUP_UI_LIFECYCLE=true | `tests/kpost-ui/katchup/katchup-draft-persistence.spec.ts:17` |
| 1 | drives the composer/send; set KATCHUP_UI_LIFECYCLE=true | `tests/kpost-ui/katchup/katchup-functional.spec.ts:42` |
| 1 | creates a real group and sends a real message; set KATCHUP_UI_LIFECYCLE=true | `tests/kpost-ui/katchup/katchup-group-receipts-e2e.spec.ts:62` |
| 1 | sends and forwards real messages; set KATCHUP_UI_LIFECYCLE=true | `tests/kpost-ui/katchup/katchup-multi-forward-e2e.spec.ts:20` |
| 1 | (no reason string) process.env.KATCHUP_UI_LIFECYCLE !== 'true', 'confirms a real report (and may bl | `tests/kpost-ui/katchup/katchup-report-contact-e2e.spec.ts:84` |
| 1 | writes real messages between two accounts; set KATCHUP_UI_LIFECYCLE=true | `tests/kpost-ui/katchup/katchup-two-session.spec.ts:40` |
| 1 | sends a real message between two accounts; set KATCHUP_UI_LIFECYCLE=true | `tests/kpost-ui/katchup/katchup-unread-badge-refresh.spec.ts:24` |
| 1 | chromium reading the clipboard needs a permission Playwright grants only in Chromium (Chromium-only by design) | `tests/kpost-ui/kmail/kmail-actions-e2e.spec.ts:151` |
| 1 | uploads a file and sends a real mail; set KMAIL_UI_LIFECYCLE=true | `tests/kpost-ui/kmail/kmail-attach-send-e2e.spec.ts:21` |
| 1 | (no reason string) process.env.KATCHUP_UI_LIFECYCLE !== 'true', 'needs the 2nd account (auth2.setup | `tests/kpost-ui/kmail/kmail-browse-e2e.spec.ts:179` |
| 1 | changes KMail settings; set SETTINGS_UI_LIFECYCLE=true | `tests/kpost-ui/kmail/kmail-settings-e2e.spec.ts:19` |
| 1 | needs auth2.setup.ts to log STORAGE_STATE_2 in as a real 2nd account; set KATCHUP_UI_LIFECYCLE=true | `tests/kpost-ui/kmail/kmail-stored-xss-render.spec.ts:25` |
| 1 | measures real page loads on the shared server; set PERF_SINGLE_USER=true | `tests/kpost-ui/platform/performance-single-user.spec.ts:27` |
| 1 | visual regression is opt-in: run `npm run product:kpost-ui:visual:update` to baseline, then `npm run product:kpost-ui:visual` | `tests/kpost-ui/platform/visual.spec.ts:18` |
| 1 | writes a profile record; set PROFILE_UI_LIFECYCLE=true | `tests/kpost-ui/profile/profile-actions.spec.ts:57` |
| 1 | the mobile field is read-only in this editor by design — a verified number changes through its own OTP flow, not this form | `tests/kpost-ui/profile/profile-functional.spec.ts:188` |
| 1 | writes to the QA profile; set PROFILE_UI_LIFECYCLE=true | `tests/kpost-ui/profile/profile-sections-save-e2e.spec.ts:163` |
| 1 | qa.business needs the BUSINESS_S session (BUSINESS_UI_LIFECYCLE=true, QA_BUSINESS_S_KPOST_ID) | `tests/kpost-ui/sanity/sanity-screens.spec.ts:100` |
| 1 | writes real company registration details; set BUSINESS_UI_LIFECYCLE=true | `tests/kpost-ui/settings/settings-business-company-details.spec.ts:16` |
| 1 | toggles a real privacy setting; set SETTINGS_UI_LIFECYCLE=true | `tests/kpost-ui/settings/settings-digital-card.spec.ts:13` |
| 1 | toggles a real preference; set SETTINGS_UI_LIFECYCLE=true | `tests/kpost-ui/settings/settings-functional.spec.ts:38` |
| 1 | uploads/removes a real cover image; set SETTINGS_UI_LIFECYCLE=true | `tests/kpost-ui/settings/settings-profile-creation.spec.ts:12` |
| 1 | adds a real Instant Reply; set SETTINGS_UI_LIFECYCLE=true | `tests/kpost-ui/settings/settings-security.spec.ts:18` |
| 1 | changes a real (cosmetic) preference; set SETTINGS_UI_LIFECYCLE=true | `tests/kpost-ui/settings/settings-theme.spec.ts:12` |
| 1 | creates a real diary schedule; set KDIARY_UI_LIFECYCLE=true | `tests/kpost-ui/verticals/kdiary-e2e.spec.ts:17` |
| 1 | creates and deletes a real document; set KOS_UI_LIFECYCLE=true | `tests/kpost-ui/verticals/kword.spec.ts:65` |

## Live condition — the application had nothing to test this run (118)

| Sites | Reason | Where |
| ----: | ------ | ----- |
| 15 | the Contacts panel was not showing right now (a session or load condition, not a Contacts defect) — see support/contacts.ts | `tests/kpost-ui/contacts/contacts-accessibility.spec.ts:108`, `tests/kpost-ui/contacts/contacts-accessibility.spec.ts:122`, `tests/kpost-ui/contacts/contacts-accessibility.spec.ts:138`, `tests/kpost-ui/contacts/contacts-functional.spec.ts:37` +11 more |
| 10 | already-exists the random mobile happened to collide — re-run | `tests/kpost-ui/auth/signup-business-medium-large.spec.ts:172`, `tests/kpost-ui/auth/signup-business.spec.ts:132`, `tests/kpost-ui/auth/signup-login-accessibility.spec.ts:217`, `tests/kpost-ui/auth/signup-login-accessibility.spec.ts:250` +6 more |
| 10 | invalid the OTP bypass code was rejected this run — re-run | `tests/kpost-ui/auth/signup-business-medium-large.spec.ts:177`, `tests/kpost-ui/auth/signup-business.spec.ts:137`, `tests/kpost-ui/auth/signup-login-accessibility.spec.ts:222`, `tests/kpost-ui/auth/signup-login-accessibility.spec.ts:255` +6 more |
| 3 | invalid the OTP bypass code was rejected this run — likely transient; re-run | `tests/kpost-ui/auth/signup-business-medium-large.spec.ts:70`, `tests/kpost-ui/auth/signup-business.spec.ts:325`, `tests/kpost-ui/auth/signup-mobile-lifecycle.spec.ts:52` |
| 3 | already-exists the randomly generated mobile number happened to already be registered — vanishingly rare; re-run | `tests/kpost-ui/auth/signup-validation.spec.ts:58`, `tests/kpost-ui/auth/signup-validation.spec.ts:139`, `tests/kpost-ui/auth/signup-validation.spec.ts:181` |
| 3 | invalid the OTP box rejected the bypass code this run — see enterMobileOtp's own doc comment; re-run | `tests/kpost-ui/auth/signup-validation.spec.ts:63`, `tests/kpost-ui/auth/signup-validation.spec.ts:144`, `tests/kpost-ui/auth/signup-validation.spec.ts:186` |
| 3 | the new group was not listed in Katchup right now (four reloads) | `tests/kpost-ui/group/group-admin-e2e.spec.ts:216`, `tests/kpost-ui/group/group-info.spec.ts:214`, `tests/kpost-ui/group/group-post-targeting.spec.ts:47` |
| 2 | the QA company name could not be read right now; not invented | `tests/admin-api/flows/role-posting-lifecycle.spec.ts:598`, `tests/admin-api/performance/latency.spec.ts:298` |
| 2 | already-exists the randomly generated mobile number happened to already be registered — re-run | `tests/kpost-ui/auth/signup-kpostid-length-validation.spec.ts:38`, `tests/kpost-ui/auth/signup-pincode-validation.spec.ts:38` |
| 2 | invalid the OTP box rejected the bypass code this run — see enterMobileOtp's doc comment; re-run | `tests/kpost-ui/auth/signup-kpostid-length-validation.spec.ts:43`, `tests/kpost-ui/auth/signup-pincode-validation.spec.ts:43` |
| 2 | the fixed probe id was not accepted right now — step 2 was not shown | `tests/kpost-ui/auth/signup-login-accessibility.spec.ts:157`, `tests/kpost-ui/auth/signup-login-screens.spec.ts:133` |
| 2 | the fixed probe id was not accepted right now — the password step (and its Forgot Password link) was not shown | `tests/kpost-ui/auth/signup-login-accessibility.spec.ts:176`, `tests/kpost-ui/auth/signup-login-screens.spec.ts:165` |
| 2 | taken the generated local part happened to collide — re-run | `tests/kpost-ui/auth/signup-login-api-handling.spec.ts:144`, `tests/kpost-ui/auth/signup-validation.spec.ts:204` |
| 2 | the Basic Information editor was not showing right now (session or load condition; path verified live 2026-10-11) | `tests/kpost-ui/profile/profile-functional.spec.ts:67`, `tests/kpost-ui/profile/profile-functional.spec.ts:176` |
| 2 | the Instant Reply editor was not showing right now (session or load condition; path verified live 2026-10-11) | `tests/kpost-ui/settings/settings-functional.spec.ts:127`, `tests/kpost-ui/settings/settings-security.spec.ts:56` |
| 1 | the QA company's name could not be read right now — not invented; set up a role posting or company name first | `tests/admin-api/flows/role-posting-lifecycle.spec.ts:173` |
| 1 | the probe location was not created (HTTP … …) | `tests/admin-api/security/cross-tenant-reads.spec.ts:75` |
| 1 | the QA company has no workplace tier values on this account to place a location under | `tests/admin-ui/admin-setup/workplace-location-setup.spec.ts:74` |
| 1 | no employee was available to pick on the … tab | `tests/admin-ui/human-resources/admin-employee-management-pii.spec.ts:41` |
| 1 | Submit button was not available on this tab right now (admin role gating) | `tests/admin-ui/screens/admin-dead-screens.spec.ts:59` |
| 1 | "Menu Privilege" nav link was not available right now (admin role gating) | `tests/admin-ui/screens/admin-dead-screens.spec.ts:104` |
| 1 | "Postal Code Library" nav link was not available right now (admin role gating) | `tests/admin-ui/screens/admin-dead-screens.spec.ts:131` |
| 1 | no letterhead is available on this account to set | `tests/kmail-api/flows/signature-letterhead-workflow.spec.ts:186` |
| 1 | no transaction row was created to attack | `tests/kmail-api/security/mutation-idor.spec.ts:66` |
| 1 | no real marker available on this account right now (empty recent-activity window) | `tests/kpost-api/dashboard/feature.spec.ts:109` |
| 1 | no city returned for "chennai" right now — cannot chain the search | `tests/kpost-api/kbooking/feature.spec.ts:49` |
| 1 | no reachable destination returned for this source city right now | `tests/kpost-api/kbooking/feature.spec.ts:64` |
| 1 | no trips running on the first six real routes 14 days out right now — nothing to chain tripdetails to | `tests/kpost-api/kbooking/feature.spec.ts:85` |
| 1 | the trip lists no boarding point right now — nothing to look up | `tests/kpost-api/kbooking/feature.spec.ts:123` |
| 1 | no news feed on this target to read (the server has no KNews feeds configured) | `tests/kpost-api/knews/knews-workflow.spec.ts:69` |
| 1 | no deactivated accounts on this target to check against | `tests/kpost-api/profile/directory-lookup.spec.ts:138` |
| 1 | no route answered the outsider right now (timeouts) — the IDOR question was not checked this run | `tests/kpost-api/security/katchup-attachment-idor.spec.ts:134` |
| 1 | image upload failed (replied …) | `tests/kpost-api/security/katchup-idor-regression-2026-10-03.spec.ts:352` |
| 1 | could not read back a real …; nothing to attack | `tests/kpost-api/security/profile-record-object-authorization.spec.ts:95` |
| 1 | already-exists … was reported as already registered — set a fresh … | `tests/kpost-ui/auth/signup-business-medium-large.spec.ts:64` |
| 1 | taken "…" is already registered — set a fresh … | `tests/kpost-ui/auth/signup-business-medium-large.spec.ts:103` |
| 1 | taken "…" is already taken — set a fresh … | `tests/kpost-ui/auth/signup-business-medium-large.spec.ts:107` |
| 1 | taken ….… is taken — set a fresh … | `tests/kpost-ui/auth/signup-business-medium-large.spec.ts:114` |
| 1 | taken the generated company name happened to collide — re-run | `tests/kpost-ui/auth/signup-business-medium-large.spec.ts:209` |
| 1 | taken the generated unique name happened to collide — re-run | `tests/kpost-ui/auth/signup-business-medium-large.spec.ts:213` |
| 1 | taken the generated KPOST ID happened to collide — re-run | `tests/kpost-ui/auth/signup-business-medium-large.spec.ts:220` |
| 1 | taken the generated id collided — re-run | `tests/kpost-ui/auth/signup-business.spec.ts:249` |
| 1 | every spare QA account is already a contact right now — nothing new to add | `tests/kpost-ui/contacts/contacts-functional.spec.ts:206` |
| 1 | the directory search returned no Qatest… Bench right now — cannot drive add | `tests/kpost-ui/contacts/contacts-functional.spec.ts:233` |
| 1 | the Contacts panel was not showing right now (session or load condition) | `tests/kpost-ui/cross-layer/cross-layer-flows.spec.ts:277` |
| 1 | the new group was not listed in Katchup right now — a list condition | `tests/kpost-ui/group/group-exit-e2e.spec.ts:70` |
| 1 | the new group was not listed in Katchup right now (four reloads) — a list or session condition, not a Group Info defect | `tests/kpost-ui/group/group-info.spec.ts:41` |
| 1 | the new group is absent from Katchup right now (four reloads) | `tests/kpost-ui/group/group-member-profile-session.spec.ts:64` |
| 1 | this account has no message history to click into — nothing to test | `tests/kpost-ui/home/home-functional.spec.ts:156` |
| 1 | the name-capture modal was not showing right now (the crash-safety test above covers the failure mode) | `tests/kpost-ui/kall/global-kool-kall.spec.ts:51` |
| 1 | no past start time is available right now (needs an hour of today behind us) | `tests/kpost-ui/kall/kall-validation.spec.ts:95` |
| 1 | no chat-header avatar rendered right now (header still loading) — nothing to click | `tests/kpost-ui/katchup/chat-avatar-session.spec.ts:61` |
| 1 | the second contact (…) is not in this account's Recents right now — nothing to switch to | `tests/kpost-ui/katchup/katchup-draft-persistence.spec.ts:53` |
| 1 | no contact matching "…" is in this account's address book right now — nothing to forward to | `tests/kpost-ui/katchup/katchup-forward-subflow-e2e.spec.ts:80` |
| 1 | Select All only picked … messages here — need 6+, nothing to test right now | `tests/kpost-ui/katchup/katchup-multi-forward-e2e.spec.ts:196` |
| 1 | no contact matching "Qatest3" is in this account\'s address book right now — nothing to transfer to | `tests/kpost-ui/katchup/katchup-transfer-subflow-e2e.spec.ts:70` |
| 1 | qatest1 has no outside-domain contacts on this account to open | `tests/kpost-ui/kmail/kmail-browse-e2e.spec.ts:346` |
| 1 | the header offers no language other than English right now | `tests/kpost-ui/platform/i18n-switch.spec.ts:70` |
| 1 | the Contact Information editor was not showing right now (session or load condition; path verified live 2026-10-11) | `tests/kpost-ui/profile/profile-functional.spec.ts:137` |
| 1 | the Education/School form was not showing right now (session or load condition; path verified live 2026-10-11) | `tests/kpost-ui/profile/profile-functional.spec.ts:231` |
| 1 | the Experience form was not showing right now (session or load condition; path verified live 2026-10-11) | `tests/kpost-ui/profile/profile-functional.spec.ts:257` |
| 1 | the About editor was not showing right now (session or load condition; path verified live 2026-10-11) | `tests/kpost-ui/profile/profile-functional.spec.ts:282` |
| 1 | Enter Address line 1 no saved address on this account yet, so the required fields cannot be kept as they are | `tests/kpost-ui/profile/profile-sections-save-e2e.spec.ts:223` |
| 1 | no saved address on this account yet, so there is no required value to clear | `tests/kpost-ui/profile/profile-validation.spec.ts:88` |
| 1 | no plan rows are reachable from the Data Storage panel right now (radios and Buy open nothing) — the plan modal is covered on /kcloud | `tests/kpost-ui/settings/settings-data-storage.spec.ts:85` |
| 1 | the Notification settings panel was not showing right now (session or load condition; path verified live 2026-10-11) | `tests/kpost-ui/settings/settings-functional.spec.ts:72` |
| 1 | no member mobile number was listed on the page right now — nothing to collide with | `tests/kpost-ui/user-management/usermanagement.spec.ts:75` |
| 1 | no merchants returned right now — nothing to click through | `tests/kpost-ui/verticals/ecommerce.spec.ts:60` |
| 1 | the directory search returned no entry for "…" (… / India / English) right now — set KDIRECTORY_SEARCH_TERM to a listed name | `tests/kpost-ui/verticals/kdirectory-launch.spec.ts:90` |
| 1 | no article loaded to share (live feed may be empty right now) | `tests/kpost-ui/verticals/knews.spec.ts:121` |

## No reason string — classified from the condition only; Phase 1 gives each one a reason (0)

_None._

## Unclassified — must be 0 (the build fails otherwise) (0)

_None._

