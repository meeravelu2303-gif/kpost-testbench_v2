# Skip ledger — every skip reason in the suite, classified

**GENERATED — do not edit.** Written by `tests/framework/coverage/skip-ledger.spec.ts`
(`npm run framework`). Edit the specs, not this file.

A skip is honest only when its reason says what kind of skip it is. Five classes a skip may
be in, one it should not stay in (no reason string), and one that fails the build (unclassified).

| Class | Sites | Spec files |
| ----- | ----: | ---------: |
| Retune | 1 | 1 |
| Blocked by a defect | 48 | 27 |
| Provision | 470 | 319 |
| Owner decision | 263 | 194 |
| Live condition | 151 | 70 |
| No reason string | 3 | 1 |
| Unclassified | 58 | 15 |
| **Total** | **994** | **371** |

## The last run, by the engine’s own skip classes

Run `run-efdc0f7c-bbc8-4890-bb0a-74be220f5b40` at 2026-11-05T03:04:42.275Z: 0 checks, 0 applicable ran (0% passed), 0 skipped:

| Engine skip class | Checks | Meaning |
| ----------------- | -----: | ------- |
| notApplicable | 0 | the validator does not apply to that endpoint (by design) |
| recoverable | 0 | needs a fixture, an id or a second principal — a gap to close |
| blockedByDefect | 0 | an open defect stops the check from being meaningful |
| deliberate | 0 | an owner pause or a safety choice |
| environmental | 0 | host or transport trouble this run |

## Retune — a selector that no longer matches, or a defect; Phase 1 drives this to 0 (1)

| Sites | Reason | Where |
| ----: | ------ | ----- |
| 1 | Bulk Mail is not offered on this build (its button is commented out in WriteMailPage.js) | `tests/kpost-ui/validation/kmail/kmail-validation.spec.ts:293` |

## Blocked by a defect — an open bug stops the check from meaning anything (48)

| Sites | Reason | Where |
| ----: | ------ | ----- |
| 3 | scheduledKall did not return a kallID (status …) | `tests/kpost-api/security/kall/kall-legacy-writes-regression-2026-10-07.spec.ts:38`, `tests/kpost-api/security/kall/kall-legacy-writes-regression-2026-10-07.spec.ts:87`, `tests/kpost-api/security/kall/kall-legacy-writes-regression-2026-10-07.spec.ts:133` |
| 3 | kall-initiate did not return a kallID to attack (placed replied …) | `tests/kpost-api/security/kall/kall-object-authorization.spec.ts:57`, `tests/kpost-api/security/kall/kall-object-authorization.spec.ts:152`, `tests/kpost-api/security/kall/kall-object-authorization.spec.ts:415` |
| 3 | sendMessage did not return a msgID (status …) | `tests/kpost-api/security/katchup/katchup-cross-account-idor-2026-10-12.spec.ts:51`, `tests/kpost-api/security/katchup/katchup-cross-account-idor-2026-10-12.spec.ts:112`, `tests/kpost-api/security/katchup/katchup-legacy-recall-regression-2026-10-07.spec.ts:40` |
| 3 | send did not return a msgID (replied …) | `tests/kpost-api/security/katchup/katchup-idor-regression-2026-10-03.spec.ts:44`, `tests/kpost-api/security/katchup/katchup-idor-regression-2026-10-03.spec.ts:169`, `tests/kpost-api/security/katchup/katchup-idor-regression-2026-10-03.spec.ts:253` |
| 3 | group-create did not return a groupKpostID (replied …) | `tests/kpost-api/security/katchup/katchup-idor-regression-2026-10-03.spec.ts:329`, `tests/kpost-api/security/katchup/katchup-idor-regression-2026-10-03.spec.ts:426`, `tests/kpost-api/security/katchup/katchup-object-authorization.spec.ts:224` |
| 2 | kmail-post-mail did not return a kmailID (…) | `tests/kmail-api/security/content-idor.spec.ts:64`, `tests/kmail-api/security/copies-info-idor.spec.ts:67` |
| 2 | BLOCKED: needs the msgID from "a message sends" | `tests/kpost-api/flows/katchup/katchup-lifecycle.spec.ts:101`, `tests/kpost-api/flows/katchup/katchup-lifecycle.spec.ts:112` |
| 2 | BLOCKED: needs the message from "send" | `tests/kpost-api/flows/katchup/katchup-workflow-db.spec.ts:94`, `tests/kpost-api/flows/katchup/katchup-workflow-db.spec.ts:168` |
| 2 | sendMessage did not return a msgID to attack (send replied …) — activates automatically once one is issued | `tests/kpost-api/security/katchup/katchup-object-authorization.spec.ts:50`, `tests/kpost-api/security/katchup/katchup-object-authorization.spec.ts:122` |
| 1 | BLOCKED: needs the record from "1 create" | `tests/framework/reporting/run-continuity.spec.ts:100` |
| 1 | BLOCKED: needs never the record from a step that failed | `tests/framework/reporting/run-continuity.spec.ts:102` |
| 1 | API open call returns an empty record (kmailID 0) — the intermittent empty-record fault #1348, seen in the browser too on 2026-10-22; parked until it is fixed | `tests/kmail-api/flows/mail-semantics-workflow.spec.ts:218` |
| 1 | Dev-confirmed 2026-09-26: this route is not in use — intentionally unavailable on this build, not a deployment gap. testkmail answers a plain Spring 404 "Not Found" for POST /draft/draftMailMultiPart, consistent with that. Not exercised, by design. | `tests/kmail-api/flows/manage-workflow.spec.ts:217` |
| 1 | Dev-confirmed 2026-09-26: letterhead id "1" IS the shared system default — "other[s] are should be added by user for their own customization." This matches the evidence already on file (getLetterHead marks id 1 `"default":"Y"` at a generic S3 path). So deleting id 1 is confirmed unsafe, exactly as suspected — not a remaining open question. What blocks a live test now is narrower: the KMail OpenAPI contract and workbook register only get-all/get-current/get-template/set-active-by-id/delete-by-id for letterheads — no create/save/upload route a user would call to add their own, so this bench has no way to create a personal letterhead to safely delete instead. Needs the dev to name which endpoint the "add your own" flow actually calls (not documented in the KMAILAPI workbook) before this can be tested end to end; not worked around by deleting the shared default. | `tests/kmail-api/flows/manage-workflow.spec.ts:308` |
| 1 | Dev-confirmed 2026-09-26: this route is not in use — intentionally unavailable on this build, not a deployment gap. Consistent with the plain Spring 404 "route not mapped" it returns. Not exercised, by design. | `tests/kmail-api/flows/manage-workflow.spec.ts:335` |
| 1 | unOpenedMailCountBySenderID is currently 500 for every account | `tests/kmail-api/flows/reads-workflow.spec.ts:103` |
| 1 | BLOCKED: needs the mail from "send" | `tests/kmail-api/flows/workflow-db.spec.ts:103` |
| 1 | BLOCKED: needs the mail and its transaction row from "send" | `tests/kmail-api/flows/workflow-db.spec.ts:134` |
| 1 | kmail-post-mail did not return a kmailID to attack (send replied …) | `tests/kmail-api/security/mutation-idor.spec.ts:57` |
| 1 | also blocked on #499 (kos-create-doc does not return a docId) independent of deferral | `tests/kpost-api/excluded/concurrency/scenarios.spec.ts:173` |
| 1 | blocked by Bugzilla #499 (kword/create 500) — activates automatically once a docId is issued (create replied …) | `tests/kpost-api/excluded/kdoc/kword-object-authorization.spec.ts:58` |
| 1 | katchup-send-multipart is the OLD direct-upload path — owner-confirmed 2026-09-26 that the current client uses the presigned-URL flow instead (aws-katchup-presigned + a direct S3 PUT + katchup-send-message's own uuid field). The route stays registered (generic validator sweep still runs against it) but its attachment-storage behaviour is no longer product- relevant, so it is not asserted on live. The prior finding is closed as #614 WONTFIX, not chased further. See presigned-attachment-workflow.spec.ts for the current, real upload path. | `tests/kpost-api/flows/katchup/katchup-attachment-workflow.spec.ts:12` |
| 1 | deactivateAccount is sideEffect:'global' AND otpDependent:'requires' — doubly blocked on live. Disabling the QA account mid-suite would take every other test down with it. Never run for real; only the off-live negative probes touch it. | `tests/kpost-api/flows/profile/profile-device-workflow.spec.ts:107` |
| 1 | kall-scheduled did not return a kallID to attack (scheduled replied …) | `tests/kpost-api/security/kall/kall-object-authorization.spec.ts:286` |
| 1 | send did not return a sharedMessageId (replied …) | `tests/kpost-api/security/katchup/katchup-idor-regression-2026-10-03.spec.ts:104` |
| 1 | the group send did not return a msgID (replied …) | `tests/kpost-api/security/katchup/katchup-object-authorization.spec.ts:246` |
| 1 | createEvent did not return a usable eventID; cannot continue | `tests/kpost-api/security/kdiary/kdiary-object-authorization.spec.ts:54` |
| 1 | … is genuinely already registered — set a fresh QA_SIGNUP_UI_MOBILE the signup screen's mobile Verify step is broken (a repeat of #720): it misreports this free number as taken, so the OTP modal never opens | `tests/kpost-ui/e2e/auth/signup-login-e2e.spec.ts:75` |
| 1 | invalid the OTP box just rejected the bypass code — likely test-infra noise (rate-limiting from concurrent heavy traffic on this host, see #721/INVALID), not a real defect; re-run once no other suite is hitting the same API host | `tests/kpost-ui/e2e/auth/signup-login-e2e.spec.ts:87` |
| 1 | blocked by #1343 — group thread older-page request 500s on open | `tests/kpost-ui/e2e/katchup/katchup-group-receipts-e2e.spec.ts:89` |
| 1 | /writemail rendered the error boundary ("Something went wrong") — #990-shaped crash, reported by screens-batch4, not a compose finding | `tests/kpost-ui/e2e/kmail/kmail-compose-e2e.spec.ts:16` |
| 1 | the message did not send (see Katchup send defects) — edit state not reachable | `tests/kpost-ui/functional/katchup/katchup-functional.spec.ts:140` |
| 1 | /writemail rendered the error boundary ("Something went wrong") — #990-shaped crash, reported by screens-batch4, not a composer-control finding | `tests/kpost-ui/functional/kmail/kmail-composer-controls-functional.spec.ts:30` |
| 1 | /writemail rendered the error boundary ("Something went wrong") — #990-shaped crash, reported by screens-batch4, not a compose-fuzz finding | `tests/kpost-ui/security/kmail/kmail-security.spec.ts:58` |

## Provision — an account, connection, host or secret this machine lacks (470)

| Sites | Reason | Where |
| ----: | ------ | ----- |
| 91 | qa.bench needs a real live account (QA_KPOST_ID) | `tests/kpost-ui/accessibility/contacts/contacts-accessibility.spec.ts:29`, `tests/kpost-ui/accessibility/home/home-accessibility.spec.ts:21`, `tests/kpost-ui/accessibility/kall/kall-accessibility.spec.ts:23`, `tests/kpost-ui/accessibility/kmail/kmail-accessibility.spec.ts:20` +87 more |
| 33 | needs the KPOST_QA connection | `tests/framework/local-tools/_diff-accounts.local.spec.ts:24`, `tests/framework/local-tools/_snapshot-accounts.local.spec.ts:23`, `tests/kmail-api/flows/workflow-db.spec.ts:105`, `tests/kmail-api/flows/workflow-db.spec.ts:136` +29 more |
| 28 | (no reason string) kmailAuthGate() !== undefined, kmailAuthGate() ?? '' | `tests/kmail-api/coverage/kmail-api.spec.ts:16`, `tests/kmail-api/engine/contract.spec.ts:8`, `tests/kmail-api/engine/read.spec.ts:12`, `tests/kmail-api/flows/attachment-integrity.spec.ts:29` +24 more |
| 26 | qa.bench needs both QA accounts | `tests/kpost-ui/accessibility/katchup/katchup-accessibility.spec.ts:23`, `tests/kpost-ui/api-handling/katchup/katchup-api-handling.spec.ts:17`, `tests/kpost-ui/api-handling/katchup/katchup-write-api-handling.spec.ts:23`, `tests/kpost-ui/cross-layer/cross-layer-flows-e2e.spec.ts:47` +22 more |
| 17 | qa.bench needs a real QA account (QA_KPOST_ID) | `tests/kpost-ui/api-handling/contacts/contacts-digitalcard-api-handling.spec.ts:162`, `tests/kpost-ui/api-handling/contacts/contacts-digitalcard-api-handling.spec.ts:333`, `tests/kpost-ui/api-handling/group/group-create-api-handling.spec.ts:78`, `tests/kpost-ui/api-handling/kall/kall-dashboard-api-handling.spec.ts:83` +13 more |
| 13 | needs the KPOST_QA connection to judge by the row | `tests/kmail-api/security/mutation-idor.spec.ts:36`, `tests/kpost-api/excluded/kdoc/kword-object-authorization.spec.ts:33`, `tests/kpost-api/security/contacts/contacts-group-cross-user.spec.ts:198`, `tests/kpost-api/security/contacts/contacts-group-cross-user.spec.ts:335` +9 more |
| 11 | qa.business needs the BUSINESS_S account (QA_BUSINESS_S_KPOST_ID) | `tests/kpost-ui/accessibility/user-management/usermanagement-accessibility.spec.ts:32`, `tests/kpost-ui/api-handling/user-management/usermanagement-api-handling.spec.ts:24`, `tests/kpost-ui/e2e/settings/settings-business-bank-details-e2e.spec.ts:19`, `tests/kpost-ui/e2e/settings/settings-business-company-details-e2e.spec.ts:20` +7 more |
| 9 | needs the 2nd QA account (QA_VICTIM_KPOST_ID) | `tests/kpost-ui/api-handling/contacts/contacts-digitalcard-api-handling.spec.ts:166`, `tests/kpost-ui/api-handling/katchup/katchup-message-api-handling.spec.ts:155`, `tests/kpost-ui/validation/contacts/contacts-digitalcard-validation.spec.ts:21`, `tests/kpost-ui/validation/kall/kall-validation.spec.ts:81` +5 more |
| 9 | qa.bench needs both QA accounts (QA_KPOST_ID, QA_VICTIM_KPOST_ID) | `tests/kpost-ui/e2e/katchup/katchup-actions-e2e.spec.ts:23`, `tests/kpost-ui/e2e/katchup/katchup-actions-more-e2e.spec.ts:34`, `tests/kpost-ui/e2e/katchup/katchup-compose-e2e.spec.ts:32`, `tests/kpost-ui/e2e/katchup/katchup-content-correctness-e2e.spec.ts:62` +5 more |
| 6 | qa.business.m needs the BUSINESS_M account of the QA testing company (QA_BUSINESS_M_KPOST_ID) | `tests/admin-api/engine/endpoint-matrix.spec.ts:345`, `tests/admin-api/maintenance/qa-leftovers-cleanup.spec.ts:40`, `tests/admin-api/performance/latency.spec.ts:149`, `tests/admin-api/validation/field-rules-sweep.spec.ts:325` +2 more |
| 6 | qa.business.m needs the BUSINESS_M account (QA_BUSINESS_M_KPOST_ID + QA_BUSINESS_M_COMPANY_ID) | `tests/admin-api/flows/feature.spec.ts:63`, `tests/admin-api/flows/reads-workflow.spec.ts:16`, `tests/admin-api/security/cross-tenant-reads.spec.ts:16`, `tests/admin-api/security/cross-tenant-writes.spec.ts:180` +2 more |
| 6 | qa.bench qa.bench needs both QA accounts (QA_KPOST_ID, QA_VICTIM_KPOST_ID) | `tests/kmail-api/flows/reply-forward-workflow.spec.ts:51`, `tests/kpost-api/flows/katchup/katchup-unread-count-clears-on-read.spec.ts:36`, `tests/kpost-ui/e2e/katchup/katchup-received-actions-e2e.spec.ts:78`, `tests/kpost-ui/e2e/katchup/katchup-two-session-e2e.spec.ts:44` +2 more |
| 6 | account registry says which role is missing (requireAll) | `tests/kmail-api/flows/workflow-db.spec.ts:36`, `tests/kpost-api/flows/contacts/contacts-workflow.spec.ts:21`, `tests/kpost-api/flows/contacts/contacts-workflow.spec.ts:159`, `tests/kpost-api/flows/profile/profile-workflow.spec.ts:19` +2 more |
| 6 | needs the personal and personal-3 principals | `tests/kpost-api/security/aws/aws-object-access.spec.ts:174`, `tests/kpost-api/security/kbooking/kbooking-cross-user.spec.ts:95`, `tests/kpost-api/security/kdiary/kdiary-cross-user.spec.ts:78`, `tests/kpost-api/security/kdiary/kdiary-object-authorization.spec.ts:40` +2 more |
| 6 | qa.victim needs the 2nd QA account (QA_VICTIM_KPOST_ID) | `tests/kpost-ui/api-handling/kmail/kmail-compose-api-handling.spec.ts:75`, `tests/kpost-ui/api-handling/kmail/kmail-thread-api-handling.spec.ts:63`, `tests/kpost-ui/functional/kmail/kmail-translate-i18n-functional.spec.ts:16`, `tests/kpost-ui/resilience/kmail/kmail-compose-resilience.spec.ts:107` +2 more |
| 5 | needs the KPOST_QA connection to assert persistence | `tests/kmail-api/flows/workflow-db.spec.ts:44`, `tests/kpost-api/flows/katchup/katchup-workflow-db.spec.ts:53`, `tests/kpost-api/flows/katchup/katchup-workflow-db.spec.ts:92`, `tests/kpost-api/flows/katchup/katchup-workflow-db.spec.ts:125` +1 more |
| 5 | needs two distinct KPost principals | `tests/kpost-api/excluded/kdoc/kword-object-authorization.spec.ts:22`, `tests/kpost-api/security/kall/kall-legacy-writes-regression-2026-10-07.spec.ts:19`, `tests/kpost-api/security/kall/kall-object-authorization.spec.ts:519`, `tests/kpost-api/security/katchup/katchup-legacy-recall-regression-2026-10-07.spec.ts:19` +1 more |
| 4 | qa.bench needs a real account (QA_KPOST_ID) | `tests/kpost-ui/accessibility/platform/platform-axe-accessibility.spec.ts:27`, `tests/kpost-ui/accessibility/platform/platform-keyboard-accessibility.spec.ts:19`, `tests/kpost-ui/resilience/platform/platform-network-resilience.spec.ts:19`, `tests/kpost-ui/visual/platform/platform-visual.spec.ts:22` |
| 3 | not configured for this run: … | `tests/admin-api/smoke/admin-api.smoke.spec.ts:17`, `tests/kmail-api/smoke/kmail-api.smoke.spec.ts:15`, `tests/kpost-api/smoke/kpost-api.smoke.spec.ts:15` |
| 3 | needs three QA accounts | `tests/kmail-api/flows/mail-semantics-workflow.spec.ts:46`, `tests/kmail-api/validation/draft-rules.spec.ts:75`, `tests/kmail-api/validation/send-rules.spec.ts:33` |
| 3 | needs provisioned qatest_* accounts | `tests/kmail-api/flows/workflow-db.spec.ts:42`, `tests/kmail-api/flows/workflow-db.spec.ts:101`, `tests/kmail-api/flows/workflow-db.spec.ts:131` |
| 3 | needs the primary account | `tests/kpost-api/flows/profile/profile-workflow.spec.ts:54`, `tests/kpost-api/flows/profile/profile-workflow.spec.ts:72`, `tests/kpost-api/flows/profile/profile-workflow.spec.ts:117` |
| 3 | needs the account the Settings endpoints sign in as (QA_PERSONAL5) | `tests/kpost-api/flows/settings/settings-notifications-workflow.spec.ts:31`, `tests/kpost-api/flows/settings/settings-notifications-workflow.spec.ts:85`, `tests/kpost-api/flows/settings/settings-personalize-workflow.spec.ts:18` |
| 3 | needs three distinct KPost principals | `tests/kpost-api/security/kall/kall-object-authorization.spec.ts:26`, `tests/kpost-api/security/katchup/katchup-cross-account-idor-2026-10-12.spec.ts:35`, `tests/kpost-api/security/katchup/katchup-idor-regression-2026-10-03.spec.ts:20` |
| 3 | qa.bench qa.p3 needs the primary, 2nd and personal-3 QA accounts | `tests/kpost-ui/e2e/group/group-post-targeting-e2e.spec.ts:25`, `tests/kpost-ui/functional/group/group-info-functional.spec.ts:65`, `tests/kpost-ui/functional/group/group-member-profile-session-functional.spec.ts:28` |
| 3 | needs both QA accounts, qatest1 and qatest3 | `tests/kpost-ui/e2e/kmail/kmail-browse-e2e.spec.ts:28`, `tests/kpost-ui/e2e/kmail/kmail-phone-e2e.spec.ts:24`, `tests/kpost-ui/e2e/kmail/kmail-status-e2e.spec.ts:32` |
| 3 | needs the second QA account (QA_VICTIM_KPOST_ID) | `tests/kpost-ui/smoke/contacts.smoke.spec.ts:16`, `tests/kpost-ui/smoke/katchup.smoke.spec.ts:24`, `tests/kpost-ui/smoke/kmail.smoke.spec.ts:22` |
| 2 | qa.business.m needs the BUSINESS_M account of the QA testing company (QA_BUSINESS_M_KPOST_ID + QA_BUSINESS_M_COMPANY_ID) | `tests/admin-api/flows/role-posting-lifecycle.spec.ts:122`, `tests/admin-api/flows/role-posting-lifecycle.spec.ts:516` |
| 2 | needs both BUSINESS_M and BUSINESS_S principals | `tests/admin-api/security/cross-tenant-reads.spec.ts:15`, `tests/admin-api/security/cross-tenant-writes.spec.ts:179` |
| 2 | the KMail BASE_URL is not configured | `tests/kmail-api/security/bulk-status-cross-user.spec.ts:26`, `tests/kmail-api/security/translator-postmail-no-login.spec.ts:30` |
| 2 | needs the 4th and 5th QA accounts | `tests/kmail-api/security/credential-disclosure.spec.ts:54`, `tests/kpost-api/validation/contacts/contacts-block-enforcement.spec.ts:68` |
| 2 | needs the 3rd and 4th QA accounts | `tests/kmail-api/security/group-read-status-idor.spec.ts:35`, `tests/kpost-api/validation/profile/profile-privacy-stored-value.spec.ts:19` |
| 2 | needs the primary QA account | `tests/kmail-api/validation/settings-rules.spec.ts:64`, `tests/kpost-ui/e2e/kmail/kmail-settings-e2e.spec.ts:23` |
| 2 | needs the BUSINESS_S admin principal | `tests/kpost-api/security/admin/admin-bank-company-cross-company.spec.ts:15`, `tests/kpost-api/security/admin/admin-usermanagement-cross-company.spec.ts:15` |
| 2 | needs a real QA_BUSINESS_M_COMPANY_ID distinct from the attacker's own company | `tests/kpost-api/security/admin/admin-bank-company-cross-company.spec.ts:17`, `tests/kpost-api/security/admin/admin-usermanagement-cross-company.spec.ts:17` |
| 2 | KPOST_API_BASE_URL / API_BASE_URL is not set | `tests/kpost-api/security/kbooking/kbooking-cross-user.spec.ts:96`, `tests/kpost-api/validation/kbooking/kbooking-rules.spec.ts:211` |
| 2 | needs the writable KPOST_QA connection to put the account back | `tests/kpost-api/security/profile/profile-mass-assignment.spec.ts:37`, `tests/kpost-api/validation/profile/profile-privacy-stored-value.spec.ts:27` |
| 2 | needs QA_PASSWORD | `tests/kpost-api/security/signup-login/signup-login-session.spec.ts:59`, `tests/kpost-api/security/signup-login/signup-login-session.spec.ts:106` |
| 2 | no KPost principal configured | `tests/kpost-api/security/signup-login/signup-login-session.spec.ts:68`, `tests/kpost-api/security/signup-login/signup-login-session.spec.ts:109` |
| 2 | qa.victim needs the 2nd QA account as the member (QA_VICTIM_KPOST_ID) | `tests/kpost-ui/api-handling/group/group-create-api-handling.spec.ts:82`, `tests/kpost-ui/resilience/group/group-create-resilience.spec.ts:76` |
| 2 | qa.victim needs the 2nd QA account to invite (QA_VICTIM_KPOST_ID) | `tests/kpost-ui/api-handling/kall/kall-dashboard-api-handling.spec.ts:168`, `tests/kpost-ui/api-handling/kall/kall-dashboard-api-handling.spec.ts:202` |
| 2 | qa.bench needs a live QA account | `tests/kpost-ui/api-handling/kmail/kmail-api-handling.spec.ts:16`, `tests/kpost-ui/security/platform/platform-hardcoded-host-security.spec.ts:17` |
| 2 | needs a real live account (QA_VICTIM_KPOST_ID) | `tests/kpost-ui/api-handling/verticals/global-digital-card-api-handling.spec.ts:46`, `tests/kpost-ui/security/profile/profile-webview-security.spec.ts:39` |
| 2 | needs the primary QA account (QA_KPOST_ID) | `tests/kpost-ui/api-handling/verticals/kdiary-api-handling.spec.ts:127`, `tests/kpost-ui/validation/verticals/kdiary-validation.spec.ts:82` |
| 2 | qa.bench needs a real live account | `tests/kpost-ui/e2e/profile/profile-actions-e2e.spec.ts:61`, `tests/kpost-ui/functional/kall/kall-features-functional.spec.ts:106` |
| 2 | needs a second QA account as the recipient | `tests/kpost-ui/functional/kmail/kmail-composer-controls-functional.spec.ts:257`, `tests/kpost-ui/functional/kmail/kmail-composer-controls-functional.spec.ts:299` |
| 2 | needs a real QA account (QA_KPOST_ID) | `tests/kpost-ui/validation/verticals/kdiary-participants-validation.spec.ts:26`, `tests/kpost-ui/validation/verticals/kdirectory-validation.spec.ts:16` |
| 1 | roleEmployeeMobile roleEmployeeEmail needs the reserved QA test-employee identity in .env (QA_ROLE_EMPLOYEE_MOBILE + QA_ROLE_EMPLOYEE_EMAIL) | `tests/admin-api/flows/role-posting-lifecycle.spec.ts:118` |
| 1 | list delete maintenance only: set ADMIN_QA_CLEANUP=list (read-only) or ADMIN_QA_CLEANUP=delete | `tests/admin-api/maintenance/qa-leftovers-cleanup.spec.ts:36` |
| 1 | qa.business.m roleEmployeeMobile roleEmployeeEmail needs the QA company admin (QA_BUSINESS_M_*) and the QA employee identity (QA_ROLE_EMPLOYEE_*) | `tests/admin-api/maintenance/setup-staff-employee.spec.ts:31` |
| 1 | roleEmployeeMobile roleEmployeeEmail needs ADMIN_ROLE_POSTING_LIVE=true and the reserved QA employee identity (QA_ROLE_EMPLOYEE_MOBILE/EMAIL) | `tests/admin-api/performance/latency.spec.ts:272` |
| 1 | needs ADMIN_API_BASE_URL (the Admin test box) | `tests/admin-api/sanity/read-sweep.spec.ts:15` |
| 1 | needs the reserved QA test-employee identity in .env (QA_ROLE_EMPLOYEE_MOBILE + QA_ROLE_EMPLOYEE_EMAIL) | `tests/admin-api/security/cross-tenant-writes.spec.ts:193` |
| 1 | needs the BUSINESS_M principal (QA company 242) | `tests/admin-api/validation/short-name-validation.spec.ts:73` |
| 1 | ADMIN_MONGO_URI is not configured (read-only) — needed to judge the Admin document | `tests/admin-ui/cross-layer/admin-cross-layer-e2e.spec.ts:58` |
| 1 | needs a configured admin host | `tests/admin-ui/functional/admin-login-functional.spec.ts:11` |
| 1 | "Add From Application" tab not reachable with this account\'s role value | `tests/admin-ui/screens/admin-dead-screens.spec.ts:46` |
| 1 | no finding supplied — pass --bug=<file.json> (see the usage block above) | `tests/framework/bug-tracker/manual-bug.spec.ts:164` |
| 1 | no local .env on this machine (fresh checkout / CI) | `tests/framework/config/env-template.spec.ts:62` |
| 1 | needs at least two configured accounts | `tests/framework/config/kmail-flags.spec.ts:128` |
| 1 | needs BUGZILLA_URL and BUGZILLA_API_KEY | `tests/framework/config/ownership.spec.ts:300` |
| 1 | needs provisioned React source on this machine (set FRONTEND_SRC) | `tests/framework/coverage/ui-rule-coverage.spec.ts:222` |
| 1 | no pre-run snapshot found — run _snapshot-accounts.local.spec.ts first | `tests/framework/local-tools/_diff-accounts.local.spec.ts:25` |
| 1 | an Admin connection has been configured | `tests/framework/safety/admin-db-safety.spec.ts:69` |
| 1 | needs four distinct QA principals configured (QA_* accounts) | `tests/kmail-api/security/copies-info-idor.spec.ts:28` |
| 1 | needs the KPOST_QA database to read the mailbox passwords | `tests/kmail-api/security/credential-disclosure.spec.ts:61` |
| 1 | needs provisioned KMail mailboxes for the 4th and 5th QA accounts (no kmail_password row) | `tests/kmail-api/security/credential-disclosure.spec.ts:72` |
| 1 | needs the KPOST_QA connection to read the contact row | `tests/kmail-api/security/kmail-cross-user.spec.ts:174` |
| 1 | needs the KMail host (KMAIL_API_BASE_URL) | `tests/kmail-api/security/repository-exposure.spec.ts:26` |
| 1 | needs two QA accounts | `tests/kmail-api/validation/manage-rules.spec.ts:24` |
| 1 | needs provisioned DB_ALLOW_WRITES=true: the API cannot remove saved bank details, so the column is restored in the QA DB | `tests/kpost-api/flows/admin/admin-company-details-lifecycle.spec.ts:107` |
| 1 | needs the BUSINESS_M and BUSINESS_S admins and the 5th QA account | `tests/kpost-api/flows/common/common-company-logo-lifecycle.spec.ts:73` |
| 1 | needs the KPOST_QA connection to resolve the real membership id | `tests/kpost-api/flows/group/group-feature.spec.ts:310` |
| 1 | needs the 5th QA account | `tests/kpost-api/flows/katchup/katchup-multipart-upload.spec.ts:24` |
| 1 | needs the KPOST_QA database to remove the attachment row | `tests/kpost-api/flows/katchup/katchup-multipart-upload.spec.ts:28` |
| 1 | needs the KPOST_QA database to see read_time | `tests/kpost-api/flows/katchup/katchup-offline-delivery.spec.ts:76` |
| 1 | needs the KPOST_QA connection (DB_HOST/DB_NAME) to prove the account exists | `tests/kpost-api/flows/profile/profile-directory-lookup.spec.ts:20` |
| 1 | set QA_COMPANY_NAME to a real company name to unblock this | `tests/kpost-api/flows/profile/profile-feature.spec.ts:336` |
| 1 | needs the KPOST_QA database to pick the id and remove the account | `tests/kpost-api/flows/profile/profile-throwaway-account.spec.ts:63` |
| 1 | set QA_NEG_KPOST_ID + QA_NEG_PASSWORD to a dedicated throwaway account so wrong-password attempts never lock the primary QATEST account | `tests/kpost-api/flows/signup-login/signup-login-login-flow.spec.ts:103` |
| 1 | no.such.user.9f2a@kpost.in set QA_FORGOT_PASSWORD_KPOST_ID to a spare account whose password may be rewritten; unset, this flow has no safe target | `tests/kpost-api/flows/signup-login/signup-login-otp-signup-lifecycle.spec.ts:385` |
| 1 | needs the writable KPOST_QA connection to remove the filler | `tests/kpost-api/maintenance/boundary-filler-cleanup.spec.ts:68` |
| 1 | needs provisioned qatest3 and the QA_BUSINESS_S admin | `tests/kpost-api/security/admin/admin-write-authorization.spec.ts:30` |
| 1 | needs three KPost principals (personal-3..5) | `tests/kpost-api/security/contacts/contacts-group-cross-user.spec.ts:423` |
| 1 | needs the KPOST_QA connection to clean the group up | `tests/kpost-api/security/contacts/contacts-group-cross-user.spec.ts:425` |
| 1 | needs two KPost principals (personal, personal-5) | `tests/kpost-api/security/contacts/contacts-group-cross-user.spec.ts:498` |
| 1 | needs three KPost principals (personal-3..5) and the 2nd QA account (QA_VICTIM_KPOST_ID) | `tests/kpost-api/security/group/group-object-authorization.spec.ts:240` |
| 1 | needs three distinct KPost principals (personal, victim, personal-3) | `tests/kpost-api/security/kall/kall-cross-user.spec.ts:155` |
| 1 | qa.p4 needs QA_PERSONAL_4_KPOST_ID as a second participant (a call cannot lose its last member) | `tests/kpost-api/security/kall/kall-cross-user.spec.ts:231` |
| 1 | qa.p5 needs a real QA_PERSONAL_5_KPOST_ID account not already in the attacker's contacts | `tests/kpost-api/security/kall/kall-object-authorization.spec.ts:524` |
| 1 | needs the 3rd, 4th and 5th QA accounts | `tests/kpost-api/security/katchup/katchup-change-caption.spec.ts:73` |
| 1 | needs the KPOST_QA database to read the row | `tests/kpost-api/security/katchup/katchup-change-caption.spec.ts:80` |
| 1 | needs a KPost principal | `tests/kpost-api/security/katchup/katchup-filter-messageby-leak-guard-2026-10-12.spec.ts:17` |
| 1 | needs the personal-5 and victim principals | `tests/kpost-api/security/katchup/katchup-object-authorization.spec.ts:180` |
| 1 | BLOCKED: needs a QA account (personal or victim) that already has a bus booking whose details it can read; no booking is created here (real seat hold + payment) | `tests/kpost-api/security/kbooking/kbooking-cross-user.spec.ts:150` |
| 1 | the … BASE_URL is not configured | `tests/kpost-api/security/platform/cors-policy.spec.ts:26` |
| 1 | needs two distinct KPost principals (personal + personal-3) | `tests/kpost-api/security/platform/object-authorization.spec.ts:23` |
| 1 | needs the shared QA password to act as a second account | `tests/kpost-api/security/platform/object-authorization.spec.ts:24` |
| 1 | needs the KPOST_QA connection to judge by the row, not the reply | `tests/kpost-api/security/platform/object-authorization.spec.ts:67` |
| 1 | needs the 5th QA account (personal-5) | `tests/kpost-api/security/platform/privileged-endpoints.spec.ts:63` |
| 1 | needs the 4th QA account and the KPost API host | `tests/kpost-api/security/platform/session-revocation.spec.ts:53` |
| 1 | needs the personal-3 principal | `tests/kpost-api/security/profile/profile-cross-user.spec.ts:66` |
| 1 | needs the KPOST_QA database for the throwaway account and the read-back | `tests/kpost-api/security/profile/profile-cross-user.spec.ts:74` |
| 1 | needs the 2nd and 4th QA accounts | `tests/kpost-api/security/profile/profile-mass-assignment.spec.ts:30` |
| 1 | needs the personal-3 and personal-4 principals | `tests/kpost-api/security/settings/settings-cross-user.spec.ts:197` |
| 1 | needs the personal principal | `tests/kpost-api/validation/kbooking/kbooking-rules.spec.ts:101` |
| 1 | needs the personal-5 principal (QA_PERSONAL5) | `tests/kpost-api/validation/settings/settings-rules.spec.ts:176` |
| 1 | the legacy reference account is absent from this target | `tests/kpost-api/validation/signup-login/signup-login-domain-policy.spec.ts:134` |
| 1 | needs the QA account (QA_KPOST_ID) | `tests/kpost-ui/api-handling/auth/login-api-handling.spec.ts:60` |
| 1 | needs provisioned qatest3 (the group creator) | `tests/kpost-ui/api-handling/katchup/katchup-message-api-handling.spec.ts:256` |
| 1 | qa.p3 needs the 3rd QA account (QA_PERSONAL_3_KPOST_ID) to create the group | `tests/kpost-ui/api-handling/kmail/kmail-thread-api-handling.spec.ts:178` |
| 1 | needs provisioned active member in the BUSINESS_S company | `tests/kpost-ui/api-handling/user-management/usermanagement-api-handling.spec.ts:45` |
| 1 | needs provisioned member the admin can make backup admin | `tests/kpost-ui/api-handling/user-management/usermanagement-api-handling.spec.ts:61` |
| 1 | needs the KPOST_QA connection (DB_HOST/DB_NAME) for the database half | `tests/kpost-ui/cross-layer/cross-layer-login-e2e.spec.ts:35` |
| 1 | needs QA_PASSWORD to drive a real login | `tests/kpost-ui/cross-layer/cross-layer-login-e2e.spec.ts:39` |
| 1 | no.such.user needs a real spare account — set QA_FORGOT_PASSWORD_KPOST_ID (never QA_KPOST_ID) | `tests/kpost-ui/e2e/auth/login-forgot-password-e2e.spec.ts:26` |
| 1 | needs the KPOST_QA database (DB_ENABLED) to read the OTP that was sent | `tests/kpost-ui/e2e/auth/login-forgot-password-e2e.spec.ts:47` |
| 1 | already-exists … was reported as already registered — unexpected on the Business path per source, but handled defensively; set a fresh QA_SIGNUP_BUSINESS_UI_MOBILE | `tests/kpost-ui/e2e/auth/signup-business-e2e.spec.ts:356` |
| 1 | taken "…" is already registered — set a fresh QA_SIGNUP_BUSINESS_COMPANY_NAME | `tests/kpost-ui/e2e/auth/signup-business-e2e.spec.ts:388` |
| 1 | taken "…" is already taken — set a fresh QA_SIGNUP_BUSINESS_UNIQUE_NAME | `tests/kpost-ui/e2e/auth/signup-business-e2e.spec.ts:392` |
| 1 | taken ….… is taken — set a fresh QA_SIGNUP_BUSINESS_DESIGNATION_ID or QA_SIGNUP_BUSINESS_UNIQUE_NAME | `tests/kpost-ui/e2e/auth/signup-business-e2e.spec.ts:399` |
| 1 | taken … is taken under a different mobile than … — set a fresh QA_SIGNUP_UI_KPOST_ID_LOCAL | `tests/kpost-ui/e2e/auth/signup-login-e2e.spec.ts:107` |
| 1 | already-exists … is already registered — set a fresh QA_SIGNUP_MOBILE_VIEWPORT_UI_MOBILE | `tests/kpost-ui/e2e/auth/signup-mobile-e2e.spec.ts:46` |
| 1 | taken … is taken — set a fresh QA_SIGNUP_MOBILE_VIEWPORT_UI_KPOST_ID_LOCAL | `tests/kpost-ui/e2e/auth/signup-mobile-e2e.spec.ts:70` |
| 1 | needs the primary and personal-4 QA accounts | `tests/kpost-ui/e2e/contacts/contacts-actions-e2e.spec.ts:81` |
| 1 | needs the 1st, 2nd, 3rd and 4th QA accounts | `tests/kpost-ui/e2e/group/group-admin-e2e.spec.ts:60` |
| 1 | qa.bench needs the second QA account (QA_VICTIM_KPOST_ID) | `tests/kpost-ui/e2e/katchup/katchup-continuous-send-e2e.spec.ts:27` |
| 1 | needs 3 QA accounts (QA_KPOST_ID, QA_VICTIM_KPOST_ID, QA_PERSONAL_3_KPOST_ID) | `tests/kpost-ui/e2e/katchup/katchup-copies-e2e.spec.ts:35` |
| 1 | qa.bench qa.p3 needs all three QA accounts (QA_KPOST_ID, QA_VICTIM_KPOST_ID, a configured personal-3 account) | `tests/kpost-ui/e2e/katchup/katchup-group-receipts-e2e.spec.ts:66` |
| 1 | qa.bench needs the primary QA account | `tests/kpost-ui/e2e/katchup/katchup-report-contact-e2e.spec.ts:17` |
| 1 | needs both QA accounts | `tests/kpost-ui/e2e/kmail/kmail-actions-e2e.spec.ts:25` |
| 1 | needs the three QA accounts | `tests/kpost-ui/e2e/kmail/kmail-features-e2e.spec.ts:34` |
| 1 | needs the qatest1 and qatest3 accounts | `tests/kpost-ui/e2e/kmail/kmail-more-actions-e2e.spec.ts:105` |
| 1 | qa.bench needs a real QA account | `tests/kpost-ui/e2e/profile/profile-sections-save-e2e.spec.ts:167` |
| 1 | the Company Registration edit form was not showing right now (needs the BUSINESS_S session; path unverified since 2026-10-11) | `tests/kpost-ui/e2e/settings/settings-business-company-details-e2e.spec.ts:50` |
| 1 | needs QA_KPOST_ID | `tests/kpost-ui/functional/auth/login-functional.spec.ts:16` |
| 1 | qa.bench needs a real, known KPOST ID to reach the password step | `tests/kpost-ui/functional/auth/login-submit-locks-functional.spec.ts:12` |
| 1 | qa.bench needs both QA accounts (a group needs at least one other member) | `tests/kpost-ui/functional/group/group-create-functional.spec.ts:16` |
| 1 | qa.p4 needs a configured personal-4 account to add | `tests/kpost-ui/functional/group/group-info-functional.spec.ts:194` |
| 1 | qa.bench needs a real live account and a 2nd account to open a conversation with | `tests/kpost-ui/functional/katchup/katchup-chat-avatar-session-functional.spec.ts:26` |
| 1 | qa.victim needs the 2nd QA account (QA_VICTIM_KPOST_ID) to open a conversation with | `tests/kpost-ui/functional/katchup/katchup-composer-controls-functional.spec.ts:18` |
| 1 | qa.business needs the BUSINESS_S company admin account (QA_BUSINESS_S_KPOST_ID) | `tests/kpost-ui/journeys/business-admin.spec.ts:19` |
| 1 | the directory returned no one for QA_MOBILE_EXISTS right now (live condition) | `tests/kpost-ui/journeys/contacts.spec.ts:43` |
| 1 | needs the KPOST_QA database to pick the identity and remove it | `tests/kpost-ui/journeys/first-use.spec.ts:79` |
| 1 | qa.bench needs a live, logged-in QA account | `tests/kpost-ui/performance/platform/platform-page-load-performance.spec.ts:31` |
| 1 | needs the KPOST_QA database (DB_ENABLED) to pick the id and remove it | `tests/kpost-ui/sanity/sanity-signup.spec.ts:58` |
| 1 | qa.victim needs a second real account to name (QA_VICTIM_KPOST_ID) | `tests/kpost-ui/security/verticals/verticals-access-security.spec.ts:142` |
| 1 | qa.p5 needs the spare QA account (QA_PERSONAL_5_KPOST_ID) | `tests/kpost-ui/smoke/auth.smoke.spec.ts:18` |
| 1 | needs the group-creator QA account (personal-3) | `tests/kpost-ui/smoke/group.smoke.spec.ts:18` |
| 1 | qa.bench the authenticated checks need a real live account (QA_KPOST_ID) | `tests/kpost-ui/smoke/platform-monitoring-smoke.spec.ts:50` |
| 1 | set QA_LOGIN_MISMATCH_MOBILE to a registered India mobile to exercise the country/number mismatch | `tests/kpost-ui/validation/auth/login-country-mismatch-validation.spec.ts:15` |
| 1 | qa.bench needs a real, already-registered live account (QA_KPOST_ID) as the known-taken value | `tests/kpost-ui/validation/auth/signup-validation.spec.ts:245` |
| 1 | needs the 2nd QA account (QA_VICTIM_KPOST_ID) in the address book | `tests/kpost-ui/validation/contacts/contacts-validation.spec.ts:45` |
| 1 | needs the 1st and 2nd QA accounts | `tests/kpost-ui/validation/group/group-admin-validation.spec.ts:115` |
| 1 | needs the 2nd QA account | `tests/kpost-ui/validation/group/group-validation.spec.ts:58` |
| 1 | needs the 1st, 2nd and 3rd QA accounts | `tests/kpost-ui/validation/group/group-validation.spec.ts:99` |
| 1 | needs the 2nd QA account in the browser account’s contacts (provision it) | `tests/kpost-ui/validation/kall/kall-validation.spec.ts:244` |
| 1 | needs provisioned membership of at least six groups | `tests/kpost-ui/validation/katchup/katchup-attachment-message-validation.spec.ts:149` |
| 1 | needs provisioned qatest3 and the browser account | `tests/kpost-ui/validation/katchup/katchup-compose-validation.spec.ts:47` |
| 1 | needs provisioned conversation with more than five loaded messages | `tests/kpost-ui/validation/katchup/katchup-select-validation.spec.ts:150` |
| 1 | needs the 3rd QA account (QA_PERSONAL_3_KPOST_ID) | `tests/kpost-ui/validation/kmail/kmail-validation.spec.ts:52` |
| 1 | needs provisioned conversation with more than ten loaded mails | `tests/kpost-ui/validation/kmail/kmail-validation.spec.ts:198` |
| 1 | needs provisioned browser account principal | `tests/kpost-ui/validation/kmail/kmail-validation.spec.ts:233` |

## Owner decision — gated flows, pauses and safety choices (263)

| Sites | Reason | Where |
| ----: | ------ | ----- |
| 12 | the mobile OTP bypass code only validates on the confirmed OTP test gateway | `tests/kpost-ui/accessibility/auth/signup-login-accessibility.spec.ts:207`, `tests/kpost-ui/accessibility/auth/signup-login-accessibility.spec.ts:239`, `tests/kpost-ui/api-handling/auth/signup-login-api-handling.spec.ts:35`, `tests/kpost-ui/e2e/auth/signup-business-e2e.spec.ts:336` +8 more |
| 9 | needs the BUSINESS_S admin session; set BUSINESS_UI_LIFECYCLE=true | `tests/kpost-ui/accessibility/user-management/usermanagement-accessibility.spec.ts:28`, `tests/kpost-ui/api-handling/user-management/usermanagement-api-handling.spec.ts:20`, `tests/kpost-ui/e2e/settings/settings-business-bank-details-e2e.spec.ts:15`, `tests/kpost-ui/e2e/user-management/usermanagement-e2e.spec.ts:22` +5 more |
| 9 | writes real messages; set KATCHUP_UI_LIFECYCLE=true | `tests/kpost-ui/e2e/katchup/katchup-actions-e2e.spec.ts:19`, `tests/kpost-ui/e2e/katchup/katchup-actions-more-e2e.spec.ts:30`, `tests/kpost-ui/e2e/katchup/katchup-copies-e2e.spec.ts:31`, `tests/kpost-ui/e2e/katchup/katchup-forward-subflow-e2e.spec.ts:28` +5 more |
| 7 | (no reason string) process.env.CONCURRENCY_LIFECYCLE !== 'true', DEFERRED_REASON | `tests/kpost-api/excluded/concurrency/scenarios.spec.ts:36`, `tests/kpost-api/excluded/concurrency/scenarios.spec.ts:71`, `tests/kpost-api/excluded/concurrency/scenarios.spec.ts:172`, `tests/kpost-api/excluded/concurrency/scenarios.spec.ts:216` +3 more |
| 7 | creates and deletes a real group; set GROUP_UI_LIFECYCLE=true | `tests/kpost-ui/api-handling/kmail/kmail-thread-api-handling.spec.ts:174`, `tests/kpost-ui/e2e/group/group-admin-e2e.spec.ts:56`, `tests/kpost-ui/e2e/group/group-post-targeting-e2e.spec.ts:21`, `tests/kpost-ui/functional/group/group-info-functional.spec.ts:61` +3 more |
| 6 | sends real mails; set KMAIL_UI_LIFECYCLE=true | `tests/kpost-ui/e2e/kmail/kmail-actions-e2e.spec.ts:17`, `tests/kpost-ui/e2e/kmail/kmail-browse-e2e.spec.ts:24`, `tests/kpost-ui/e2e/kmail/kmail-features-e2e.spec.ts:26`, `tests/kpost-ui/e2e/kmail/kmail-more-actions-e2e.spec.ts:101` +2 more |
| 5 | writes to the QA company; set ADMIN_LIFECYCLE=true | `tests/admin-api/engine/endpoint-matrix.spec.ts:341`, `tests/admin-api/performance/latency.spec.ts:145`, `tests/admin-api/validation/field-rules-sweep.spec.ts:321`, `tests/admin-api/validation/input-hardening.spec.ts:168` +1 more |
| 5 | (no reason string) process.env.SIGNUP_UI_LIFECYCLE !== 'true', 'drives the real signup screen (a mo | `tests/kpost-ui/api-handling/auth/signup-login-api-handling.spec.ts:31`, `tests/kpost-ui/e2e/auth/signup-business-medium-large-e2e.spec.ts:152`, `tests/kpost-ui/validation/auth/signup-kpostid-length-validation.spec.ts:20`, `tests/kpost-ui/validation/auth/signup-pincode-validation.spec.ts:20` +1 more |
| 5 | sends a real mail; set KMAIL_UI_LIFECYCLE=true | `tests/kpost-ui/e2e/kmail/kmail-compose-e2e.spec.ts:64`, `tests/kpost-ui/e2e/kmail/kmail-read-receipt-e2e.spec.ts:85`, `tests/kpost-ui/e2e/kmail/kmail-two-session-e2e.spec.ts:18`, `tests/kpost-ui/security/kmail/kmail-security.spec.ts:18` +1 more |
| 4 | qa.business needs ADMIN_UI_LIFECYCLE=true, a configured admin host and BUSINESS_M account | `tests/admin-ui/screens/admin-dead-screens.spec.ts:14`, `tests/admin-ui/screens/admin-screens.spec.ts:23`, `tests/admin-ui/screens/admin-subtabs-screens.spec.ts:15`, `tests/admin-ui/security/employee-management-pii-security.spec.ts:14` |
| 4 | needs auth2.setup.ts for the 2nd account; set KATCHUP_UI_LIFECYCLE=true | `tests/kpost-ui/e2e/kmail/kmail-actions-e2e.spec.ts:21`, `tests/kpost-ui/e2e/kmail/kmail-features-e2e.spec.ts:30`, `tests/kpost-ui/e2e/kmail/kmail-status-e2e.spec.ts:148`, `tests/kpost-ui/e2e/kmail/kmail-status-e2e.spec.ts:313` |
| 3 | uploads a real file to S3 and sends a real mail; set KMAIL_LIFECYCLE=true and AWS_LIFECYCLE=true | `tests/kmail-api/flows/attachment-integrity.spec.ts:30`, `tests/kmail-api/security/attachment-delete-idor.spec.ts:24`, `tests/kmail-api/security/attachment-idor.spec.ts:25` |
| 3 | sends a real mail; set KMAIL_LIFECYCLE=true | `tests/kmail-api/security/content-idor.spec.ts:24`, `tests/kmail-api/security/copies-info-idor.spec.ts:24`, `tests/kmail-api/security/mutation-idor.spec.ts:26` |
| 3 | uploads a real file to S3 and sends a real message; set KATCHUP_LIFECYCLE=true and AWS_LIFECYCLE=true | `tests/kpost-api/flows/katchup/katchup-attachment-integrity.spec.ts:31`, `tests/kpost-api/flows/katchup/katchup-presigned-attachment-workflow.spec.ts:18`, `tests/kpost-api/security/katchup/katchup-attachment-idor.spec.ts:26` |
| 3 | sends a real message; set KATCHUP_LIFECYCLE=true | `tests/kpost-api/security/katchup/katchup-cross-account-idor-2026-10-12.spec.ts:36`, `tests/kpost-api/security/katchup/katchup-legacy-recall-regression-2026-10-07.spec.ts:20`, `tests/kpost-api/security/katchup/katchup-object-authorization.spec.ts:24` |
| 3 | uploads to S3; set AWS_LIFECYCLE=true | `tests/kpost-api/security/katchup/katchup-cross-user.spec.ts:117`, `tests/kpost-api/security/katchup/katchup-cross-user.spec.ts:174`, `tests/kpost-api/security/katchup/katchup-cross-user.spec.ts:269` |
| 3 | needs auth2.setup.ts to log the 2nd account in; set KATCHUP_UI_LIFECYCLE=true | `tests/kpost-ui/e2e/group/group-exit-e2e.spec.ts:91`, `tests/kpost-ui/e2e/kmail/kmail-read-receipt-e2e.spec.ts:89`, `tests/kpost-ui/e2e/kmail/kmail-two-session-e2e.spec.ts:22` |
| 3 | sends a real message; set KATCHUP_UI_LIFECYCLE=true | `tests/kpost-ui/e2e/katchup/katchup-compose-e2e.spec.ts:65`, `tests/kpost-ui/e2e/katchup/katchup-digitalcard-share-e2e.spec.ts:18`, `tests/kpost-ui/e2e/katchup/katchup-secret-message-e2e.spec.ts:13` |
| 3 | edits a profile field; set PROFILE_UI_LIFECYCLE=true | `tests/kpost-ui/e2e/profile/profile-edit-e2e.spec.ts:15`, `tests/kpost-ui/functional/profile/profile-functional.spec.ts:47`, `tests/kpost-ui/security/profile/profile-security.spec.ts:17` |
| 2 | writes real org structure; set ADMIN_LIFECYCLE=true | `tests/admin-api/flows/feature.spec.ts:59`, `tests/admin-api/validation/write-fuzz-workflow.spec.ts:208` |
| 2 | creates real KPost (testingapi) + KSMACC accounts for the QA company; set ADMIN_LIFECYCLE=true and ADMIN_ROLE_POSTING_LIVE=true | `tests/admin-api/flows/role-posting-lifecycle.spec.ts:114`, `tests/admin-api/flows/role-posting-lifecycle.spec.ts:512` |
| 2 | only meaningful when TEST_ENV=production | `tests/framework/safety/live-safety.spec.ts:566`, `tests/framework/safety/live-safety.spec.ts:591` |
| 2 | sends real KMail between our accounts; set KMAIL_LIFECYCLE=true | `tests/kmail-api/flows/mail-semantics-workflow.spec.ts:42`, `tests/kmail-api/validation/send-rules.spec.ts:29` |
| 2 | writes real KMail data; set KMAIL_LIFECYCLE=true | `tests/kmail-api/flows/manage-workflow.spec.ts:39`, `tests/kmail-api/validation/manage-rules.spec.ts:20` |
| 2 | writes real KMail settings; set KMAIL_LIFECYCLE=true | `tests/kmail-api/flows/signature-letterhead-workflow.spec.ts:34`, `tests/kmail-api/validation/settings-rules.spec.ts:60` |
| 2 | creates real groups; set GROUP_LIFECYCLE=true | `tests/kpost-api/flows/group/group-feature.spec.ts:110`, `tests/kpost-api/validation/group/group-rules.spec.ts:141` |
| 2 | writes a real message; set KATCHUP_LIFECYCLE=true to run (owner sign-off, flow doc Q4) | `tests/kpost-api/flows/katchup/katchup-lifecycle.spec.ts:16`, `tests/kpost-api/flows/katchup/katchup-workflow-db.spec.ts:21` |
| 2 | creates a real diary event; set KDIARY_LIFECYCLE=true | `tests/kpost-api/flows/kdiary/kdiary-reads-workflow.spec.ts:26`, `tests/kpost-api/security/kdiary/kdiary-object-authorization.spec.ts:36` |
| 2 | creates a real diary event and report; set KDIARY_LIFECYCLE=true | `tests/kpost-api/flows/kdiary/kdiary-reads-workflow.spec.ts:96`, `tests/kpost-api/security/kdiary/kdiary-cross-user.spec.ts:74` |
| 2 | changes account preferences; set SETTINGS_LIFECYCLE=true | `tests/kpost-api/flows/settings/settings-feature.spec.ts:33`, `tests/kpost-api/validation/settings/settings-rules.spec.ts:172` |
| 2 | creates a throwaway group; set GROUP_LIFECYCLE=true | `tests/kpost-api/security/contacts/contacts-group-cross-user.spec.ts:189`, `tests/kpost-api/security/contacts/contacts-group-cross-user.spec.ts:326` |
| 2 | presigns an S3 key; set AWS_LIFECYCLE=true | `tests/kpost-api/security/contacts/contacts-group-cross-user.spec.ts:496`, `tests/kpost-api/security/platform/cross-user-gaps.spec.ts:150` |
| 2 | places a real call; set KALL_LIFECYCLE=true | `tests/kpost-api/security/kall/kall-object-authorization.spec.ts:27`, `tests/kpost-api/security/kall/kall-status-sender-spoof.spec.ts:24` |
| 2 | drives a real mobile OTP to reach this step; set SIGNUP_UI_LIFECYCLE=true | `tests/kpost-ui/accessibility/auth/signup-login-accessibility.spec.ts:203`, `tests/kpost-ui/accessibility/auth/signup-login-accessibility.spec.ts:235` |
| 2 | creates a real group; set GROUP_UI_LIFECYCLE=true | `tests/kpost-ui/cross-layer/cross-layer-flows-e2e.spec.ts:269`, `tests/kpost-ui/functional/group/group-create-functional.spec.ts:12` |
| 2 | creates a real scheduled call; set KALL_UI_LIFECYCLE=true | `tests/kpost-ui/cross-layer/cross-layer-flows-e2e.spec.ts:405`, `tests/kpost-ui/functional/kall/kall-features-functional.spec.ts:102` |
| 2 | creates a real, permanent company; set SIGNUP_UI_LIFECYCLE=true | `tests/kpost-ui/e2e/auth/signup-business-e2e.spec.ts:332`, `tests/kpost-ui/e2e/auth/signup-business-medium-large-e2e.spec.ts:17` |
| 2 | creates a real account and sends a real mail-OTP/e-mail; set SIGNUP_UI_LIFECYCLE=true | `tests/kpost-ui/e2e/auth/signup-login-e2e.spec.ts:22`, `tests/kpost-ui/e2e/auth/signup-mobile-e2e.spec.ts:22` |
| 1 | one-time setup: set ADMIN_CREATE_STAFF=true and ADMIN_ROLE_POSTING_LIVE=true | `tests/admin-api/maintenance/setup-staff-employee.spec.ts:27` |
| 1 | opt-in: this writes to Bugzilla — run `npm run bug:apply` after a product preview | `tests/framework/bug-tracker/apply-filing-plan.spec.ts:19` |
| 1 | manual probe — set CLEANUP_PLAN=true to list orphaned QA records on the primary account, CLEANUP_EXECUTE=true to delete them | `tests/framework/local-tools/_cleanup-orphaned-records.local.spec.ts:14` |
| 1 | manual probe — set ACCOUNT_DIFF=true right after a deep write-fuzz run | `tests/framework/local-tools/_diff-accounts.local.spec.ts:19` |
| 1 | manual probe — set ACCOUNT_DIFF=true right before a deep write-fuzz run | `tests/framework/local-tools/_snapshot-accounts.local.spec.ts:18` |
| 1 | sends real mail; set KMAIL_LIFECYCLE=true | `tests/kmail-api/flows/feature.spec.ts:84` |
| 1 | sensitive: sends a password and returns the account's real mail-send credentials. The endpoint's own definition explicitly says NOT to drive it on live. Recorded as a deliberate gap, not a workaround. | `tests/kmail-api/flows/manage-workflow.spec.ts:325` |
| 1 | sends real KMail between our two accounts; set KMAIL_LIFECYCLE=true | `tests/kmail-api/flows/reply-forward-workflow.spec.ts:47` |
| 1 | sends real mail on a LIVE mail server; set KMAIL_LIFECYCLE=true to run | `tests/kmail-api/flows/workflow-db.spec.ts:25` |
| 1 | reads QA mailbox passwords from the test database; set TEST_DB_MODE=true | `tests/kmail-api/security/credential-disclosure.spec.ts:50` |
| 1 | makes a group and sends a real mail; set KMAIL_LIFECYCLE=true and GROUP_LIFECYCLE=true | `tests/kmail-api/security/group-read-status-idor.spec.ts:31` |
| 1 | writes real drafts, contacts and mail; set KMAIL_LIFECYCLE=true | `tests/kmail-api/security/kmail-cross-user.spec.ts:76` |
| 1 | uploads a real (tiny) file to S3; set AWS_LIFECYCLE=true | `tests/kmail-api/security/kmail-cross-user.spec.ts:293` |
| 1 | sends real mails; set KMAIL_LIFECYCLE=true | `tests/kmail-api/security/mail-id-idor.spec.ts:70` |
| 1 | writes real drafts; set KMAIL_LIFECYCLE=true | `tests/kmail-api/validation/draft-rules.spec.ts:74` |
| 1 | writes real KWord docs; set KOS_LIFECYCLE=true | `tests/kpost-api/excluded/kdoc/feature.spec.ts:47` |
| 1 | metered AI calls; set KOS_AI_LIVE=true to run | `tests/kpost-api/excluded/kdoc/feature.spec.ts:176` |
| 1 | testingapi answers 404 "No matching endpoint for this request" for GET /kword/documents/ — the KWord list route is not deployed on this test build (see the endpoint definition's own  | `tests/kpost-api/excluded/kdoc/feature.spec.ts:277` |
| 1 | creates a real document; set KOS_LIFECYCLE=true | `tests/kpost-api/excluded/kdoc/kword-object-authorization.spec.ts:23` |
| 1 | rewrites the QA company’s details and puts them back; set GLOBAL_LIFECYCLE=true and TEST_DB_MODE=true | `tests/kpost-api/flows/admin/admin-company-details-lifecycle.spec.ts:58` |
| 1 | creates and terminates a real company member on the QA server; set GLOBAL_LIFECYCLE=true and TEST_DB_MODE=true | `tests/kpost-api/flows/admin/admin-member-lifecycle.spec.ts:26` |
| 1 | S3 attachment lifecycle; set AWS_LIFECYCLE=true | `tests/kpost-api/flows/aws/aws-feature.spec.ts:41` |
| 1 | (no reason string) process.env.GLOBAL_LIFECYCLE !== 'true' \|\| process.env.TEST_DB_MODE !== 'true',  | `tests/kpost-api/flows/common/common-company-logo-lifecycle.spec.ts:69` |
| 1 | writes to the address book; set CONTACTS_LIFECYCLE=true | `tests/kpost-api/flows/contacts/contacts-feature.spec.ts:89` |
| 1 | writes the block state; set CONTACTS_LIFECYCLE=true | `tests/kpost-api/flows/contacts/contacts-lists-workflow.spec.ts:97` |
| 1 | places real calls between the QA accounts; set KALL_LIFECYCLE=true | `tests/kpost-api/flows/kall/kall-call-states.spec.ts:118` |
| 1 | places/schedules real calls; set KALL_LIFECYCLE=true (owner sign-off, docs/modules/kall-flow.md §5) | `tests/kpost-api/flows/kall/kall-feature.spec.ts:58` |
| 1 | places a real call; set KALL_LIFECYCLE=true (owner sign-off, docs/modules/kall-flow.md §5) | `tests/kpost-api/flows/kall/kall-reads-workflow.spec.ts:59` |
| 1 | schedules a real call; set KALL_LIFECYCLE=true (owner sign-off, docs/modules/kall-flow.md §5) | `tests/kpost-api/flows/kall/kall-reads-workflow.spec.ts:156` |
| 1 | schedules a real repeating call; set KALL_LIFECYCLE=true (owner sign-off, docs/modules/kall-flow.md §5) | `tests/kpost-api/flows/kall/kall-reads-workflow.spec.ts:216` |
| 1 | writes real messages; set KATCHUP_LIFECYCLE=true (owner sign-off, docs/modules/katchup-flow.md §6) | `tests/kpost-api/flows/katchup/katchup-feature.spec.ts:182` |
| 1 | uploads to the QA server and deletes the row after; set GLOBAL_LIFECYCLE, TEST_DB_MODE and DB_ALLOW_WRITES | `tests/kpost-api/flows/katchup/katchup-multipart-upload.spec.ts:18` |
| 1 | sends a real message between the QA accounts; set KATCHUP_LIFECYCLE=true | `tests/kpost-api/flows/katchup/katchup-offline-delivery.spec.ts:64` |
| 1 | sends a real message to get an id to test with; set KATCHUP_LIFECYCLE=true | `tests/kpost-api/flows/katchup/katchup-shared-reference-workflow.spec.ts:18` |
| 1 | sends a real message between our two accounts; set KATCHUP_LIFECYCLE=true (owner sign-off) | `tests/kpost-api/flows/katchup/katchup-unread-count-clears-on-read.spec.ts:32` |
| 1 | real third-party seat hold, unconfirmed sandbox — needs explicit authorization | `tests/kpost-api/flows/kbooking/kbooking-feature.spec.ts:148` |
| 1 | writes real diary events; set KDIARY_LIFECYCLE=true | `tests/kpost-api/flows/kdiary/kdiary-feature.spec.ts:66` |
| 1 | sendPrimaryDeviceOtp is otpDependent:'sends' with sideEffect:'external' — the SMS/OTP kill-switch in destructiveBlockReason() refuses it against any real host in every mode. Only a confirmed OTP test gateway (OTP_TEST_GATEWAY + TEST_DB_MODE, neither configured here) would open it. Not worked around: sending a real OTP on a normal run would cost money and exhaust the SMS gateway. | `tests/kpost-api/flows/profile/profile-device-workflow.spec.ts:16` |
| 1 | sendPrimaryOrSecondaryDeviceOtp is otpDependent:'sends' with sideEffect:'external' — same SMS/OTP kill-switch as sendPrimaryDeviceOtp above. | `tests/kpost-api/flows/profile/profile-device-workflow.spec.ts:28` |
| 1 | sendAccountDeactivationOtp is otpDependent:'sends' with sideEffect:'external' — same SMS/OTP kill-switch, and it is the OTP step of the account-deactivation flow, which stays blocked in its own right below regardless. | `tests/kpost-api/flows/profile/profile-device-workflow.spec.ts:37` |
| 1 | forgotPasswordOrKpostID is otpDependent:'sends' with sideEffect:'external' — a public (unauthenticated) recovery entry point that sends a real OTP; same kill-switch as the others above. | `tests/kpost-api/flows/profile/profile-device-workflow.spec.ts:47` |
| 1 | setDeviceAsPrimary is otpDependent:'requires' AND matches the guard's isSessionDestroyer pattern — blocked even when OTP_TEST_GATEWAY+TEST_DB_MODE are both set, specifically because it would displace the primary device of the account every other test in the suite is logged in as, breaking every later test in the run. Not worked around: there is no safe way to exercise this against the suite's own live session. | `tests/kpost-api/flows/profile/profile-device-workflow.spec.ts:57` |
| 1 | updateDeviceAsPrimary matches the same isSessionDestroyer pattern as setDeviceAsPrimary above, for the same reason. | `tests/kpost-api/flows/profile/profile-device-workflow.spec.ts:69` |
| 1 | setDeviceAsSecondary matches the isSessionDestroyer pattern (updateDeviceAs*/setDeviceAs*) for the same reason as the primary-device pair above. | `tests/kpost-api/flows/profile/profile-device-workflow.spec.ts:78` |
| 1 | updateDeviceAsSecondary matches the isSessionDestroyer pattern for the same reason as the others above. | `tests/kpost-api/flows/profile/profile-device-workflow.spec.ts:87` |
| 1 | changePassword is sideEffect:'global', never cleared for live under any flag. Running it would change the credential every other suite/test logs in with mid-run — a self-inflicted lockout, not a defect to find. The documented sample is also missing a distinct newPassword field from confirmPassword, which the null/required negative probes already exercise off-live. | `tests/kpost-api/flows/profile/profile-device-workflow.spec.ts:96` |
| 1 | writes real profile data; set PROFILE_LIFECYCLE=true to run | `tests/kpost-api/flows/profile/profile-feature.spec.ts:50` |
| 1 | runs only on a confirmed OTP test gateway: OTP_TEST_GATEWAY=true + TEST_DB_MODE=true | `tests/kpost-api/flows/profile/profile-throwaway-account.spec.ts:48` |
| 1 | the account is deleted from the test DB afterwards; set DB_ALLOW_WRITES=true | `tests/kpost-api/flows/profile/profile-throwaway-account.spec.ts:52` |
| 1 | OTP flows run only on a confirmed test gateway: OTP_TEST_GATEWAY=true + TEST_DB_MODE=true | `tests/kpost-api/flows/signup-login/signup-login-otp-lifecycle-db.spec.ts:18` |
| 1 | needs a real 10-minute wait; set OTP_EXPIRY_WAIT=true to run the expiry boundary | `tests/kpost-api/flows/signup-login/signup-login-otp-lifecycle-db.spec.ts:366` |
| 1 | OTP/signup flows run only on a confirmed test gateway: OTP_TEST_GATEWAY=true + TEST_DB_MODE=true | `tests/kpost-api/flows/signup-login/signup-login-otp-signup-lifecycle.spec.ts:17` |
| 1 | mints a permanent company/tenant on the test DB; set BUSINESS_SIGNUP_LIVE=true to run it. Confirmed live 2026-10-02: registers QA Bench API Business Co end to end. | `tests/kpost-api/flows/signup-login/signup-login-otp-signup-lifecycle.spec.ts:241` |
| 1 | BLOCKED: the forgot-password sender sends a real SMS even on the test gateway; the one SMS a run may send belongs to the browser test | `tests/kpost-api/flows/signup-login/signup-login-otp-signup-lifecycle.spec.ts:400` |
| 1 | maintenance only; set QA_GROUP_CLEANUP=true | `tests/kpost-api/maintenance/qa-ui-group-cleanup.spec.ts:28` |
| 1 | creates a company member and tries admin writes on it; set GLOBAL_LIFECYCLE=true and TEST_DB_MODE=true | `tests/kpost-api/security/admin/admin-write-authorization.spec.ts:26` |
| 1 | (no reason string) process.env.AWS_LIFECYCLE !== 'true', 'creates 0-byte S3 placeholders (deleted a | `tests/kpost-api/security/aws/aws-object-access.spec.ts:170` |
| 1 | creates a throwaway group with a photo; set GROUP_LIFECYCLE=true | `tests/kpost-api/security/contacts/contacts-group-cross-user.spec.ts:419` |
| 1 | schedules real calls; set KALL_LIFECYCLE=true | `tests/kpost-api/security/kall/kall-cross-user.spec.ts:159` |
| 1 | schedules a real call; set KALL_LIFECYCLE=true | `tests/kpost-api/security/kall/kall-legacy-writes-regression-2026-10-07.spec.ts:20` |
| 1 | rewrites real message rows on the QA test server; set GLOBAL_LIFECYCLE=true and TEST_DB_MODE=true | `tests/kpost-api/security/katchup/katchup-change-caption.spec.ts:69` |
| 1 | sends real messages; set KATCHUP_LIFECYCLE=true | `tests/kpost-api/security/katchup/katchup-cross-user.spec.ts:109` |
| 1 | sends real messages / creates real groups; set KATCHUP_LIFECYCLE=true | `tests/kpost-api/security/katchup/katchup-idor-regression-2026-10-03.spec.ts:21` |
| 1 | sends blockTicket / cancelticket probes that cannot hold or cancel anything; needs the owner’s authorization, then KBOOKING_LIFECYCLE=true | `tests/kpost-api/security/kbooking/kbooking-cross-user.spec.ts:166` |
| 1 | (no reason string) process.env.SETTINGS_LIFECYCLE !== 'true', 'writes the KNews settings of two QA  | `tests/kpost-api/security/knews/knews-cross-user.spec.ts:118` |
| 1 | writes a message; set KATCHUP_LIFECYCLE=true | `tests/kpost-api/security/platform/cross-user-gaps.spec.ts:46` |
| 1 | calls shared-state endpoints on the QA test server; set GLOBAL_LIFECYCLE=true and TEST_DB_MODE=true | `tests/kpost-api/security/platform/privileged-endpoints.spec.ts:59` |
| 1 | signs up a throwaway account; set PROFILE_LIFECYCLE=true | `tests/kpost-api/security/profile/profile-cross-user.spec.ts:54` |
| 1 | the throwaway signup needs the confirmed OTP test gateway: OTP_TEST_GATEWAY=true + TEST_DB_MODE=true | `tests/kpost-api/security/profile/profile-cross-user.spec.ts:58` |
| 1 | the account is deleted from the test DB and the attack is a `global` write: set DB_ALLOW_WRITES=true + GLOBAL_LIFECYCLE=true | `tests/kpost-api/security/profile/profile-cross-user.spec.ts:62` |
| 1 | creates real profile records; set PROFILE_LIFECYCLE=true | `tests/kpost-api/security/profile/profile-record-object-authorization.spec.ts:43` |
| 1 | changes two accounts' preferences and restores them; set SETTINGS_LIFECYCLE=true | `tests/kpost-api/security/settings/settings-cross-user.spec.ts:193` |
| 1 | each presign writes a placeholder to the live S3 bucket; set AWS_LIFECYCLE=true | `tests/kpost-api/validation/aws/aws-business-rules.spec.ts:33` |
| 1 | the OTP flows are opened only with OTP_TEST_GATEWAY=true and TEST_DB_MODE=true | `tests/kpost-api/validation/common/common-forgot-password-limited.spec.ts:12` |
| 1 | testingapi answers 404 "No matching endpoint for this request" for POST saveUnsubscriberDetails, live-verified 2026-09-24. Not run standalone (a 404 there reads  | `tests/kpost-api/validation/common/common-gaps.spec.ts:17` |
| 1 | blocks a QA contact and tries a call and messages; set CONTACTS_LIFECYCLE and KALL_LIFECYCLE | `tests/kpost-api/validation/contacts/contacts-block-enforcement.spec.ts:64` |
| 1 | schedules real calls; set KALL_LIFECYCLE=true (owner sign-off, docs/modules/kall-flow.md §5) | `tests/kpost-api/validation/kall/kall-reschedule-input-rules.spec.ts:54` |
| 1 | sends real messages between the QA accounts; set KATCHUP_LIFECYCLE=true | `tests/kpost-api/validation/katchup/katchup-rules.spec.ts:92` |
| 1 | calls blockTicket (a real partner seat hold) with bodies that cannot hold a seat; needs the owner’s authorization, then KBOOKING_LIFECYCLE=true | `tests/kpost-api/validation/kbooking/kbooking-rules.spec.ts:207` |
| 1 | (no reason string) process.env.SETTINGS_LIFECYCLE !== 'true', "writes A's own KNews settings (resto | `tests/kpost-api/validation/knews/knews-rules.spec.ts:137` |
| 1 | sends real messages and mails; set KATCHUP_UI_LIFECYCLE=true and KMAIL_UI_LIFECYCLE=true | `tests/kpost-ui/cross-layer/cross-layer-flows-e2e.spec.ts:43` |
| 1 | logs in and out repeatedly; set LOGIN_UI_LIFECYCLE=true | `tests/kpost-ui/e2e/auth/login-forgot-password-e2e.spec.ts:18` |
| 1 | sends ONE real SMS to the spare account; set FORGOT_PASSWORD_SMS=true (the run levels do) | `tests/kpost-ui/e2e/auth/login-forgot-password-e2e.spec.ts:22` |
| 1 | needs the OTP test gateway; set OTP_TEST_GATEWAY=true TEST_DB_MODE=true | `tests/kpost-ui/e2e/auth/signup-business-e2e.spec.ts:115` |
| 1 | changes real contacts; set CONTACTS_UI_LIFECYCLE=true | `tests/kpost-ui/e2e/contacts/contacts-actions-e2e.spec.ts:77` |
| 1 | creates real groups; set GROUP_UI_LIFECYCLE=true | `tests/kpost-ui/e2e/group/group-exit-e2e.spec.ts:87` |
| 1 | drives real uploads + sends; set KATCHUP_UI_LIFECYCLE=true | `tests/kpost-ui/e2e/katchup/katchup-attach-repeat-e2e.spec.ts:23` |
| 1 | drives a real presigned upload + send; set KATCHUP_UI_LIFECYCLE=true | `tests/kpost-ui/e2e/katchup/katchup-attach-send-e2e.spec.ts:13` |
| 1 | sends real messages; set KATCHUP_UI_LIFECYCLE=true | `tests/kpost-ui/e2e/katchup/katchup-content-correctness-e2e.spec.ts:58` |
| 1 | writes real messages; set KATCHUP_UI_LIFECYCLE=true (npm run product:kpost-ui does) | `tests/kpost-ui/e2e/katchup/katchup-continuous-send-e2e.spec.ts:23` |
| 1 | creates a real group and sends a real message; set KATCHUP_UI_LIFECYCLE=true | `tests/kpost-ui/e2e/katchup/katchup-group-receipts-e2e.spec.ts:62` |
| 1 | sends and forwards real messages; set KATCHUP_UI_LIFECYCLE=true | `tests/kpost-ui/e2e/katchup/katchup-multi-forward-e2e.spec.ts:25` |
| 1 | (no reason string) process.env.KATCHUP_UI_LIFECYCLE !== 'true', 'confirms a real report (and may bl | `tests/kpost-ui/e2e/katchup/katchup-report-contact-e2e.spec.ts:84` |
| 1 | writes real messages between two accounts; set KATCHUP_UI_LIFECYCLE=true | `tests/kpost-ui/e2e/katchup/katchup-two-session-e2e.spec.ts:40` |
| 1 | sends a real message between two accounts; set KATCHUP_UI_LIFECYCLE=true | `tests/kpost-ui/e2e/katchup/katchup-unread-badge-e2e.spec.ts:25` |
| 1 | chromium reading the clipboard needs a permission Playwright grants only in Chromium (Chromium-only by design) | `tests/kpost-ui/e2e/kmail/kmail-actions-e2e.spec.ts:151` |
| 1 | uploads a file and sends a real mail; set KMAIL_UI_LIFECYCLE=true | `tests/kpost-ui/e2e/kmail/kmail-attach-send-e2e.spec.ts:21` |
| 1 | (no reason string) process.env.KATCHUP_UI_LIFECYCLE !== 'true', 'needs the 2nd account (auth2.setup | `tests/kpost-ui/e2e/kmail/kmail-browse-e2e.spec.ts:179` |
| 1 | changes KMail settings; set SETTINGS_UI_LIFECYCLE=true | `tests/kpost-ui/e2e/kmail/kmail-settings-e2e.spec.ts:19` |
| 1 | writes a profile record; set PROFILE_UI_LIFECYCLE=true | `tests/kpost-ui/e2e/profile/profile-actions-e2e.spec.ts:57` |
| 1 | writes to the QA profile; set PROFILE_UI_LIFECYCLE=true | `tests/kpost-ui/e2e/profile/profile-sections-save-e2e.spec.ts:163` |
| 1 | writes real company registration details; set BUSINESS_UI_LIFECYCLE=true | `tests/kpost-ui/e2e/settings/settings-business-company-details-e2e.spec.ts:16` |
| 1 | toggles a real privacy setting; set SETTINGS_UI_LIFECYCLE=true | `tests/kpost-ui/e2e/settings/settings-digital-card-e2e.spec.ts:33` |
| 1 | uploads/removes a real cover image; set SETTINGS_UI_LIFECYCLE=true | `tests/kpost-ui/e2e/settings/settings-profile-photo-e2e.spec.ts:12` |
| 1 | changes a real (cosmetic) preference; set SETTINGS_UI_LIFECYCLE=true | `tests/kpost-ui/e2e/settings/settings-theme-e2e.spec.ts:12` |
| 1 | creates a real diary schedule; set KDIARY_UI_LIFECYCLE=true | `tests/kpost-ui/e2e/verticals/kdiary-e2e.spec.ts:17` |
| 1 | creates and deletes a real document; set KOS_UI_LIFECYCLE=true | `tests/kpost-ui/excluded/kdoc/kword.spec.ts:65` |
| 1 | ends the session; set LOGIN_UI_LIFECYCLE=true | `tests/kpost-ui/functional/auth/login-session-functional.spec.ts:76` |
| 1 | adds a real contact; set CONTACTS_UI_LIFECYCLE=true | `tests/kpost-ui/functional/contacts/contacts-functional.spec.ts:173` |
| 1 | Recents shows a load-error state, not an empty state — out of scope for this test | `tests/kpost-ui/functional/home/home-recents-empty-state-functional.spec.ts:29` |
| 1 | types into a real composer; set KATCHUP_UI_LIFECYCLE=true | `tests/kpost-ui/functional/katchup/katchup-draft-persistence-functional.spec.ts:22` |
| 1 | drives the composer/send; set KATCHUP_UI_LIFECYCLE=true | `tests/kpost-ui/functional/katchup/katchup-functional.spec.ts:43` |
| 1 | the mobile field is read-only in this editor by design — a verified number changes through its own OTP flow, not this form | `tests/kpost-ui/functional/profile/profile-functional.spec.ts:188` |
| 1 | toggles a real preference; set SETTINGS_UI_LIFECYCLE=true | `tests/kpost-ui/functional/settings/settings-functional.spec.ts:38` |
| 1 | measures real page loads on the shared server; set PERF_SINGLE_USER=true | `tests/kpost-ui/performance/platform/platform-page-load-performance.spec.ts:27` |
| 1 | qa.business needs the BUSINESS_S session (BUSINESS_UI_LIFECYCLE=true, QA_BUSINESS_S_KPOST_ID) | `tests/kpost-ui/sanity/sanity-screens.spec.ts:100` |
| 1 | creates (and removes) a real account; set SIGNUP_UI_LIFECYCLE=true | `tests/kpost-ui/sanity/sanity-signup.spec.ts:24` |
| 1 | the signup OTP is mocked only on the confirmed test gateway (OTP_TEST_GATEWAY + TEST_DB_MODE) | `tests/kpost-ui/sanity/sanity-signup.spec.ts:28` |
| 1 | the account is removed from KPOST_QA afterwards; set DB_ALLOW_WRITES=true | `tests/kpost-ui/sanity/sanity-signup.spec.ts:32` |
| 1 | drives a real mobile OTP to reach these screens; set SIGNUP_UI_LIFECYCLE=true | `tests/kpost-ui/screens/auth/signup-post-otp-screens.spec.ts:47` |
| 1 | blocks a real contact; set CONTACTS_UI_LIFECYCLE=true | `tests/kpost-ui/screens/contacts/contacts-screens.spec.ts:57` |
| 1 | logs the shared account out and invalidates the saved session; set SESSION_INVALIDATION_CHECK=true and run in isolation | `tests/kpost-ui/security/auth/login-token-security.spec.ts:87` |
| 1 | needs auth2.setup.ts to log STORAGE_STATE_2 in as a real 2nd account; set KATCHUP_UI_LIFECYCLE=true | `tests/kpost-ui/security/kmail/kmail-stored-xss-security.spec.ts:25` |
| 1 | adds a real Instant Reply; set SETTINGS_UI_LIFECYCLE=true | `tests/kpost-ui/security/settings/settings-security.spec.ts:18` |
| 1 | (no reason string) process.env.KALL_UI_LIFECYCLE !== 'true', 'schedules a real meeting to edit (end | `tests/kpost-ui/validation/kall/kall-validation.spec.ts:173` |
| 1 | (no reason string) process.env.KALL_UI_LIFECYCLE !== 'true', 'blocks a QA contact for the test (res | `tests/kpost-ui/validation/kall/kall-validation.spec.ts:231` |
| 1 | (no reason string) process.env.KALL_UI_LIFECYCLE !== 'true', 'schedules a real meeting (ended after | `tests/kpost-ui/validation/kall/kall-validation.spec.ts:338` |
| 1 | visual regression is opt-in: run `npm run product:kpost-ui:visual:update` to baseline, then `npm run product:kpost-ui:visual` | `tests/kpost-ui/visual/platform/platform-visual.spec.ts:18` |

## Live condition — the application had nothing to test this run (151)

| Sites | Reason | Where |
| ----: | ------ | ----- |
| 15 | the Contacts panel was not showing right now (a session or load condition, not a Contacts defect) — see support/contacts.ts | `tests/kpost-ui/accessibility/contacts/contacts-accessibility.spec.ts:108`, `tests/kpost-ui/accessibility/contacts/contacts-accessibility.spec.ts:122`, `tests/kpost-ui/accessibility/contacts/contacts-accessibility.spec.ts:138`, `tests/kpost-ui/functional/contacts/contacts-functional.spec.ts:37` +11 more |
| 10 | already-exists the random mobile happened to collide — re-run | `tests/kpost-ui/accessibility/auth/signup-login-accessibility.spec.ts:217`, `tests/kpost-ui/accessibility/auth/signup-login-accessibility.spec.ts:250`, `tests/kpost-ui/api-handling/auth/signup-login-api-handling.spec.ts:50`, `tests/kpost-ui/api-handling/auth/signup-login-api-handling.spec.ts:130` +6 more |
| 10 | invalid the OTP bypass code was rejected this run — re-run | `tests/kpost-ui/accessibility/auth/signup-login-accessibility.spec.ts:222`, `tests/kpost-ui/accessibility/auth/signup-login-accessibility.spec.ts:255`, `tests/kpost-ui/api-handling/auth/signup-login-api-handling.spec.ts:55`, `tests/kpost-ui/api-handling/auth/signup-login-api-handling.spec.ts:135` +6 more |
| 4 | the call could not be scheduled right now, so nothing to probe | `tests/kpost-api/security/kall/kall-cross-user.spec.ts:171`, `tests/kpost-api/security/kall/kall-cross-user.spec.ts:241`, `tests/kpost-api/security/kall/kall-cross-user.spec.ts:352`, `tests/kpost-api/security/kall/kall-cross-user.spec.ts:425` |
| 4 | already-exists the randomly generated mobile number happened to already be registered — re-run | `tests/kpost-ui/validation/auth/signup-kpostid-length-validation.spec.ts:38`, `tests/kpost-ui/validation/auth/signup-pincode-validation.spec.ts:38`, `tests/kpost-ui/validation/auth/signup-pincode-validation.spec.ts:88`, `tests/kpost-ui/validation/auth/signup-pincode-validation.spec.ts:134` |
| 3 | no time left today to make a task for today right now (needs two hours before midnight) | `tests/kpost-ui/api-handling/verticals/kdiary-api-handling.spec.ts:143`, `tests/kpost-ui/api-handling/verticals/kdiary-api-handling.spec.ts:176`, `tests/kpost-ui/validation/verticals/kdiary-participants-validation.spec.ts:30` |
| 3 | invalid the OTP bypass code was rejected this run — likely transient; re-run | `tests/kpost-ui/e2e/auth/signup-business-e2e.spec.ts:363`, `tests/kpost-ui/e2e/auth/signup-business-medium-large-e2e.spec.ts:71`, `tests/kpost-ui/e2e/auth/signup-mobile-e2e.spec.ts:52` |
| 3 | the new group was not listed in Katchup right now (four reloads) | `tests/kpost-ui/e2e/group/group-admin-e2e.spec.ts:216`, `tests/kpost-ui/e2e/group/group-post-targeting-e2e.spec.ts:47`, `tests/kpost-ui/functional/group/group-info-functional.spec.ts:214` |
| 3 | Enter Address line 1 no saved address on this account yet, so the required fields cannot be kept as they are | `tests/kpost-ui/e2e/profile/profile-sections-save-e2e.spec.ts:223`, `tests/kpost-ui/validation/profile/profile-field-limits-validation.spec.ts:101`, `tests/kpost-ui/validation/profile/profile-field-limits-validation.spec.ts:138` |
| 3 | already-exists the randomly generated mobile number happened to already be registered — vanishingly rare; re-run | `tests/kpost-ui/validation/auth/signup-validation.spec.ts:58`, `tests/kpost-ui/validation/auth/signup-validation.spec.ts:139`, `tests/kpost-ui/validation/auth/signup-validation.spec.ts:181` |
| 3 | invalid the OTP box rejected the bypass code this run — see enterMobileOtp's own doc comment; re-run | `tests/kpost-ui/validation/auth/signup-validation.spec.ts:63`, `tests/kpost-ui/validation/auth/signup-validation.spec.ts:144`, `tests/kpost-ui/validation/auth/signup-validation.spec.ts:186` |
| 2 | the QA company name could not be read right now; not invented | `tests/admin-api/flows/role-posting-lifecycle.spec.ts:598`, `tests/admin-api/performance/latency.spec.ts:298` |
| 2 | the fixed probe id was not accepted right now — step 2 was not shown | `tests/kpost-ui/accessibility/auth/signup-login-accessibility.spec.ts:157`, `tests/kpost-ui/screens/auth/signup-login-screens.spec.ts:133` |
| 2 | the fixed probe id was not accepted right now — the password step (and its Forgot Password link) was not shown | `tests/kpost-ui/accessibility/auth/signup-login-accessibility.spec.ts:176`, `tests/kpost-ui/screens/auth/signup-login-screens.spec.ts:165` |
| 2 | taken the generated local part happened to collide — re-run | `tests/kpost-ui/api-handling/auth/signup-login-api-handling.spec.ts:152`, `tests/kpost-ui/validation/auth/signup-validation.spec.ts:204` |
| 2 | already-exists the random mobile happened to collide right now — re-run | `tests/kpost-ui/api-handling/auth/signup-login-api-handling.spec.ts:230`, `tests/kpost-ui/e2e/auth/signup-business-medium-large-e2e.spec.ts:267` |
| 2 | invalid the OTP bypass code was rejected right now — re-run | `tests/kpost-ui/api-handling/auth/signup-login-api-handling.spec.ts:235`, `tests/kpost-ui/e2e/auth/signup-business-medium-large-e2e.spec.ts:272` |
| 2 | the Contacts panel was not showing right now (session or load condition, not a Group defect) | `tests/kpost-ui/api-handling/group/group-create-api-handling.spec.ts:37`, `tests/kpost-ui/resilience/group/group-create-resilience.spec.ts:31` |
| 2 | the Basic Information editor was not showing right now (session or load condition; path verified live 2026-10-11) | `tests/kpost-ui/functional/profile/profile-functional.spec.ts:67`, `tests/kpost-ui/functional/profile/profile-functional.spec.ts:176` |
| 2 | the Instant Reply editor was not showing right now (session or load condition; path verified live 2026-10-11) | `tests/kpost-ui/functional/settings/settings-functional.spec.ts:127`, `tests/kpost-ui/security/settings/settings-security.spec.ts:56` |
| 2 | invalid the OTP box rejected the bypass code this run — see enterMobileOtp's doc comment; re-run | `tests/kpost-ui/validation/auth/signup-kpostid-length-validation.spec.ts:43`, `tests/kpost-ui/validation/auth/signup-pincode-validation.spec.ts:43` |
| 1 | the QA company's name could not be read right now — not invented; set up a role posting or company name first | `tests/admin-api/flows/role-posting-lifecycle.spec.ts:173` |
| 1 | the probe location was not created (HTTP … …) | `tests/admin-api/security/cross-tenant-reads.spec.ts:75` |
| 1 | the QA company has no workplace tier values on this account to place a location under | `tests/admin-ui/e2e/workplace-location-setup-e2e.spec.ts:74` |
| 1 | Submit button was not available on this tab right now (admin role gating) | `tests/admin-ui/screens/admin-dead-screens.spec.ts:59` |
| 1 | "Menu Privilege" nav link was not available right now (admin role gating) | `tests/admin-ui/screens/admin-dead-screens.spec.ts:104` |
| 1 | "Postal Code Library" nav link was not available right now (admin role gating) | `tests/admin-ui/screens/admin-dead-screens.spec.ts:131` |
| 1 | no employee was available to pick on the … tab | `tests/admin-ui/security/employee-management-pii-security.spec.ts:41` |
| 1 | no letterhead is available on this account to set | `tests/kmail-api/flows/signature-letterhead-workflow.spec.ts:186` |
| 1 | the group mail returned no kmailID right now (…) | `tests/kmail-api/security/group-read-status-idor.spec.ts:71` |
| 1 | draftMail returned no kmailID (HTTP …) | `tests/kmail-api/security/kmail-cross-user.spec.ts:104` |
| 1 | a setup mail returned no kmailID right now | `tests/kmail-api/security/mail-id-idor.spec.ts:85` |
| 1 | no transaction row was created to attack | `tests/kmail-api/security/mutation-idor.spec.ts:66` |
| 1 | no real marker available on this account right now (empty recent-activity window) | `tests/kpost-api/flows/dashboard/dashboard-feature.spec.ts:109` |
| 1 | no city returned for "chennai" right now — cannot chain the search | `tests/kpost-api/flows/kbooking/kbooking-feature.spec.ts:49` |
| 1 | no reachable destination returned for this source city right now | `tests/kpost-api/flows/kbooking/kbooking-feature.spec.ts:64` |
| 1 | no trips running on the first six real routes 14 days out right now — nothing to chain tripdetails to | `tests/kpost-api/flows/kbooking/kbooking-feature.spec.ts:85` |
| 1 | the trip lists no boarding point right now — nothing to look up | `tests/kpost-api/flows/kbooking/kbooking-feature.spec.ts:123` |
| 1 | no news feed on this target to read (the server has no KNews feeds configured) | `tests/kpost-api/flows/knews/knews-workflow.spec.ts:69` |
| 1 | no deactivated accounts on this target to check against | `tests/kpost-api/flows/profile/profile-directory-lookup.spec.ts:138` |
| 1 | the call could not be placed right now (…) | `tests/kpost-api/security/kall/kall-status-sender-spoof.spec.ts:39` |
| 1 | no route answered the outsider right now (timeouts) — the IDOR question was not checked this run | `tests/kpost-api/security/katchup/katchup-attachment-idor.spec.ts:134` |
| 1 | image upload failed (replied …) | `tests/kpost-api/security/katchup/katchup-idor-regression-2026-10-03.spec.ts:352` |
| 1 | createEvent returned no eventID (HTTP …) | `tests/kpost-api/security/kdiary/kdiary-cross-user.spec.ts:97` |
| 1 | A has no report for today to attack | `tests/kpost-api/security/kdiary/kdiary-cross-user.spec.ts:290` |
| 1 | no app version to re-send right now (read answered …) | `tests/kpost-api/security/platform/privileged-endpoints.spec.ts:74` |
| 1 | could not read back a real …; nothing to attack | `tests/kpost-api/security/profile/profile-record-object-authorization.spec.ts:95` |
| 1 | taken the generated local part happened to collide right now — re-run | `tests/kpost-ui/api-handling/auth/signup-login-api-handling.spec.ts:251` |
| 1 | the new group was not listed in KMail Contacts right now (three loads) | `tests/kpost-ui/api-handling/kmail/kmail-thread-api-handling.spec.ts:208` |
| 1 | the Contacts panel was not showing right now (session or load condition) | `tests/kpost-ui/cross-layer/cross-layer-flows-e2e.spec.ts:277` |
| 1 | taken the generated id collided — re-run | `tests/kpost-ui/e2e/auth/signup-business-e2e.spec.ts:250` |
| 1 | taken the generated id collided right now — re-run | `tests/kpost-ui/e2e/auth/signup-business-e2e.spec.ts:304` |
| 1 | already-exists … was reported as already registered — set a fresh … | `tests/kpost-ui/e2e/auth/signup-business-medium-large-e2e.spec.ts:65` |
| 1 | taken "…" is already registered — set a fresh … | `tests/kpost-ui/e2e/auth/signup-business-medium-large-e2e.spec.ts:104` |
| 1 | taken "…" is already taken — set a fresh … | `tests/kpost-ui/e2e/auth/signup-business-medium-large-e2e.spec.ts:108` |
| 1 | taken ….… is taken — set a fresh … | `tests/kpost-ui/e2e/auth/signup-business-medium-large-e2e.spec.ts:115` |
| 1 | taken the generated company name happened to collide — re-run | `tests/kpost-ui/e2e/auth/signup-business-medium-large-e2e.spec.ts:210` |
| 1 | taken the generated unique name happened to collide — re-run | `tests/kpost-ui/e2e/auth/signup-business-medium-large-e2e.spec.ts:214` |
| 1 | taken the generated KPOST ID happened to collide — re-run | `tests/kpost-ui/e2e/auth/signup-business-medium-large-e2e.spec.ts:221` |
| 1 | taken the company name collided right now — re-run | `tests/kpost-ui/e2e/auth/signup-business-medium-large-e2e.spec.ts:302` |
| 1 | taken the unique name collided right now — re-run | `tests/kpost-ui/e2e/auth/signup-business-medium-large-e2e.spec.ts:303` |
| 1 | taken the KPOST ID collided right now — re-run | `tests/kpost-ui/e2e/auth/signup-business-medium-large-e2e.spec.ts:306` |
| 1 | the new group was not listed in Katchup right now — a list condition | `tests/kpost-ui/e2e/group/group-exit-e2e.spec.ts:70` |
| 1 | no contact matching "…" is in this account's address book right now — nothing to forward to | `tests/kpost-ui/e2e/katchup/katchup-forward-subflow-e2e.spec.ts:80` |
| 1 | Select All only picked … messages here — need 6+, nothing to test right now | `tests/kpost-ui/e2e/katchup/katchup-multi-forward-e2e.spec.ts:201` |
| 1 | no contact matching "Qatest3" is in this account\'s address book right now — nothing to transfer to | `tests/kpost-ui/e2e/katchup/katchup-transfer-subflow-e2e.spec.ts:70` |
| 1 | qatest1 has no outside-domain contacts on this account to open | `tests/kpost-ui/e2e/kmail/kmail-browse-e2e.spec.ts:346` |
| 1 | no member mobile number was listed on the page right now — nothing to collide with | `tests/kpost-ui/e2e/user-management/usermanagement-e2e.spec.ts:75` |
| 1 | every spare QA account is already a contact right now — nothing new to add | `tests/kpost-ui/functional/contacts/contacts-functional.spec.ts:206` |
| 1 | the directory search returned no Qatest… Bench right now — cannot drive add | `tests/kpost-ui/functional/contacts/contacts-functional.spec.ts:233` |
| 1 | the new group was not listed in Katchup right now (four reloads) — a list or session condition, not a Group Info defect | `tests/kpost-ui/functional/group/group-info-functional.spec.ts:41` |
| 1 | the new group is absent from Katchup right now (four reloads) | `tests/kpost-ui/functional/group/group-member-profile-session-functional.spec.ts:64` |
| 1 | this account has no message history to click into — nothing to test | `tests/kpost-ui/functional/home/home-functional.spec.ts:156` |
| 1 | the name-capture modal was not showing right now (the crash-safety test above covers the failure mode) | `tests/kpost-ui/functional/kall/kall-global-kool-kall-functional.spec.ts:51` |
| 1 | no chat-header avatar rendered right now (header still loading) — nothing to click | `tests/kpost-ui/functional/katchup/katchup-chat-avatar-session-functional.spec.ts:62` |
| 1 | the second contact (…) is not in this account's Recents right now — nothing to switch to | `tests/kpost-ui/functional/katchup/katchup-draft-persistence-functional.spec.ts:54` |
| 1 | the header offers no language other than English right now | `tests/kpost-ui/functional/platform/platform-i18n-functional.spec.ts:70` |
| 1 | the Contact Information editor was not showing right now (session or load condition; path verified live 2026-10-11) | `tests/kpost-ui/functional/profile/profile-functional.spec.ts:137` |
| 1 | the Education/School form was not showing right now (session or load condition; path verified live 2026-10-11) | `tests/kpost-ui/functional/profile/profile-functional.spec.ts:231` |
| 1 | the Experience form was not showing right now (session or load condition; path verified live 2026-10-11) | `tests/kpost-ui/functional/profile/profile-functional.spec.ts:257` |
| 1 | the About editor was not showing right now (session or load condition; path verified live 2026-10-11) | `tests/kpost-ui/functional/profile/profile-functional.spec.ts:282` |
| 1 | no plan rows are reachable from the Data Storage panel right now (radios and Buy open nothing) — the plan modal is covered on /kcloud | `tests/kpost-ui/functional/settings/settings-data-storage-functional.spec.ts:85` |
| 1 | the Notification settings panel was not showing right now (session or load condition; path verified live 2026-10-11) | `tests/kpost-ui/functional/settings/settings-functional.spec.ts:72` |
| 1 | no merchants returned right now — nothing to click through | `tests/kpost-ui/functional/verticals/ecommerce-functional.spec.ts:60` |
| 1 | the directory search returned no entry for "…" (… / India / English) right now — set KDIRECTORY_SEARCH_TERM to a listed name | `tests/kpost-ui/functional/verticals/kdirectory-functional.spec.ts:90` |
| 1 | no article loaded to share (live feed may be empty right now) | `tests/kpost-ui/functional/verticals/knews-functional.spec.ts:121` |
| 1 | invalid the OTP box rejected the bypass code this run; re-run | `tests/kpost-ui/validation/auth/signup-pincode-validation.spec.ts:93` |
| 1 | no past start time is available right now (needs an hour of today behind us) | `tests/kpost-ui/validation/kall/kall-validation.spec.ts:104` |
| 1 | no past end time with a future start time is available right now (needs 01:00–21:59) | `tests/kpost-ui/validation/kall/kall-validation.spec.ts:141` |
| 1 | no saved address on this account yet, so there is no required value to clear | `tests/kpost-ui/validation/profile/profile-validation.spec.ts:88` |
| 1 | redbus has no bus with a seat map for that day right now (a live condition) | `tests/kpost-ui/validation/verticals/kbooking-validation.spec.ts:150` |

## No reason string — classified from the condition only; Phase 1 gives each one a reason (3)

| Sites | Reason | Where |
| ----: | ------ | ----- |
| 3 | (no reason string) !opened, SKIP_REASON | `tests/kpost-ui/resilience/contacts/contacts-list-resilience.spec.ts:39`, `tests/kpost-ui/resilience/contacts/contacts-list-resilience.spec.ts:54`, `tests/kpost-ui/resilience/contacts/contacts-list-resilience.spec.ts:115` |

## Unclassified — must be 0 (the build fails otherwise) (58)

| Sites | Reason | Where |
| ----: | ------ | ----- |
| 2 | download did not answer the outsider (timeout) | `tests/kpost-api/security/katchup/katchup-cross-user.spec.ts:196`, `tests/kpost-api/security/katchup/katchup-cross-user.spec.ts:236` |
| 2 | no notification preference with "Do Not Disturb" is stored, so none could be restored | `tests/kpost-api/validation/settings/settings-rules.spec.ts:238`, `tests/kpost-api/validation/settings/settings-rules.spec.ts:271` |
| 2 | kpostLayoutTheme the caller has no stored theme to restore | `tests/kpost-api/validation/settings/settings-rules.spec.ts:342`, `tests/kpost-api/validation/settings/settings-rules.spec.ts:382` |
| 2 | the victim account is the signed-in account | `tests/kpost-ui/security/verticals/verticals-access-security.spec.ts:156`, `tests/kpost-ui/security/verticals/verticals-access-security.spec.ts:249` |
| 1 | the … could not be created for company 242, so nothing to probe | `tests/admin-api/security/cross-tenant-writes.spec.ts:214` |
| 1 | owner control: company 242's own read does not list the new …, so the probe proves nothing | `tests/admin-api/security/cross-tenant-writes.spec.ts:238` |
| 1 | needs the personal, victim, personal-3 and personal-5 principals | `tests/kmail-api/security/kmail-cross-user.spec.ts:80` |
| 1 | owner control: the new draft is not in A’s own draft list | `tests/kmail-api/security/kmail-cross-user.spec.ts:120` |
| 1 | owner control: A's own add + edit did not land (edit HTTP …) | `tests/kmail-api/security/kmail-cross-user.spec.ts:212` |
| 1 | generate-presigned-url named no uuid (HTTP …) | `tests/kmail-api/security/kmail-cross-user.spec.ts:318` |
| 1 | the S3 upload failed (HTTP …) | `tests/kmail-api/security/kmail-cross-user.spec.ts:324` |
| 1 | the mail with the attachment was not sent (HTTP …) | `tests/kmail-api/security/kmail-cross-user.spec.ts:346` |
| 1 | owner control: A could not download its own attachment (HTTP …), so C's refusal proves nothing | `tests/kmail-api/security/kmail-cross-user.spec.ts:384` |
| 1 | generate-presigned-url minted no uuid (HTTP …) | `tests/kpost-api/security/aws/aws-object-access.spec.ts:181` |
| 1 | katchup/generate-presigned-url minted no uuid (HTTP …) | `tests/kpost-api/security/aws/aws-object-access.spec.ts:251` |
| 1 | needs four KPost principals (personal, personal-3..5) | `tests/kpost-api/security/contacts/contacts-group-cross-user.spec.ts:193` |
| 1 | needs five KPost principals (personal, victim, personal-3..5) | `tests/kpost-api/security/contacts/contacts-group-cross-user.spec.ts:330` |
| 1 | owner control: the organiser's own read of call … failed (HTTP …), so a refusal proves nothing | `tests/kpost-api/security/kall/kall-cross-user.spec.ts:180` |
| 1 | owner control: the organiser's read of call … does not show exactly B and D as members | `tests/kpost-api/security/kall/kall-cross-user.spec.ts:244` |
| 1 | owner control: the organiser's identical add/remove did not take effect (HTTP …/…), so the outsider's refusal proves nothing | `tests/kpost-api/security/kall/kall-cross-user.spec.ts:336` |
| 1 | owner control: the organiser cannot read call … as open, so the probe proves nothing | `tests/kpost-api/security/kall/kall-cross-user.spec.ts:355` |
| 1 | owner control: the organiser's identical end did not close call … (HTTP …, status …), so the refusal proves nothing | `tests/kpost-api/security/kall/kall-cross-user.spec.ts:401` |
| 1 | owner control: the organiser's read of call … does not show B's participant row | `tests/kpost-api/security/kall/kall-cross-user.spec.ts:433` |
| 1 | the organiser could not read call … back after the probes (not re-checked) | `tests/kpost-api/security/kall/kall-cross-user.spec.ts:461` |
| 1 | owner control: B's identical join did not take effect (HTTP …), so the outsider's refusals prove nothing | `tests/kpost-api/security/kall/kall-cross-user.spec.ts:552` |
| 1 | needs the personal, victim, personal-3 and personal-4 principals | `tests/kpost-api/security/katchup/katchup-cross-user.spec.ts:105` |
| 1 | oldDownload did not answer the outsider (timeout) | `tests/kpost-api/security/katchup/katchup-cross-user.spec.ts:141` |
| 1 | generateThumbnailUsingUUID did not answer (timeout) | `tests/kpost-api/security/katchup/katchup-cross-user.spec.ts:287` |
| 1 | getSharedMessageInfo did not answer (timeout) | `tests/kpost-api/security/katchup/katchup-cross-user.spec.ts:365` |
| 1 | getSharedMessageDetails did not answer (timeout) | `tests/kpost-api/security/katchup/katchup-cross-user.spec.ts:437` |
| 1 | control: the recipient's own report was refused (HTTP … …), so the outsider probe proves nothing | `tests/kpost-api/security/katchup/katchup-cross-user.spec.ts:514` |
| 1 | reportAbuse did not answer (timeout) | `tests/kpost-api/security/katchup/katchup-cross-user.spec.ts:520` |
| 1 | after-owner-edit owner control: A's own editReport did not land (HTTP …), so the probe proves nothing | `tests/kpost-api/security/kdiary/kdiary-cross-user.spec.ts:303` |
| 1 | owner control: A's own updateKnewsSettings did not land (HTTP …), so the probe proves nothing | `tests/kpost-api/security/knews/knews-cross-user.spec.ts:139` |
| 1 | both accounts need a stored katchup preference to restore afterwards | `tests/kpost-api/security/settings/settings-cross-user.spec.ts:204` |
| 1 | both accounts need a stored font to restore afterwards | `tests/kpost-api/security/settings/settings-cross-user.spec.ts:265` |
| 1 | both accounts need a stored katchup preference and font (V restored afterwards) | `tests/kpost-api/security/settings/settings-cross-user.spec.ts:325` |
| 1 | getAllCategories lists no category to compare against | `tests/kpost-api/validation/knews/knews-rules.spec.ts:211` |
| 1 | Font Size string the caller has no stored font to restore afterwards | `tests/kpost-api/validation/settings/settings-rules.spec.ts:307` |
| 1 | the company lists no member | `tests/kpost-ui/functional/user-management/user-management-members-functional.spec.ts:50` |
| 1 | the first member has no name to search for | `tests/kpost-ui/functional/user-management/user-management-members-functional.spec.ts:76` |
| 1 | no listed member shows a mobile number | `tests/kpost-ui/functional/user-management/user-management-members-functional.spec.ts:103` |
| 1 | the listed mobile "…" is too short to search for | `tests/kpost-ui/functional/user-management/user-management-members-functional.spec.ts:107` |
| 1 | no active admin is listed | `tests/kpost-ui/functional/user-management/user-management-members-functional.spec.ts:130` |
| 1 | no active member to open | `tests/kpost-ui/functional/user-management/user-management-members-functional.spec.ts:172` |
| 1 | the KNews API never answered (not re-checked) | `tests/kpost-ui/functional/verticals/knews-feed-functional.spec.ts:44` |
| 1 | an upstream provider failed (… failed feed(s)) and the screen reports it; not a silent empty feed | `tests/kpost-ui/functional/verticals/knews-feed-functional.spec.ts:89` |
| 1 | the company lists no member to open | `tests/kpost-ui/screens/user-management/user-management-workspace-screens.spec.ts:118` |
| 1 | owner control failed: the diary's own read answered HTTP … (…), so a tampered read proves nothing | `tests/kpost-ui/security/verticals/verticals-access-security.spec.ts:176` |
| 1 | no answer to the tampered diary read (not re-checked) | `tests/kpost-ui/security/verticals/verticals-access-security.spec.ts:218` |
| 1 | nothing to compare: neither the own nor the tampered diary read returned an event for today | `tests/kpost-ui/security/verticals/verticals-access-security.spec.ts:225` |
| 1 | owner control failed: My Trips' own read answered HTTP … (…) | `tests/kpost-ui/security/verticals/verticals-access-security.spec.ts:271` |
| 1 | no answer to the tampered My Trips read (not re-checked) | `tests/kpost-ui/security/verticals/verticals-access-security.spec.ts:301` |
| 1 | nothing to compare: neither the own nor the tampered My Trips read returned a booking | `tests/kpost-ui/security/verticals/verticals-access-security.spec.ts:308` |

