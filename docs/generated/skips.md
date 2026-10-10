# Skip ledger — every skip reason in the suite, classified

**GENERATED — do not edit.** Written by `tests/framework/skip-ledger.spec.ts`
(`npm run test:framework`). Edit the specs, not this file.

A skip is honest only when its reason says what kind of skip it is. Five classes a skip may
be in, one it should not stay in (no reason string), and one that fails the build (unclassified).
The plan: `docs/reference/production-readiness-plan.md`, Phase 1.

| Class | Sites | Spec files |
| ----- | ----: | ---------: |
| Retune | 48 | 19 |
| Blocked by a defect | 37 | 20 |
| Provision | 238 | 159 |
| Owner decision | 140 | 98 |
| Live condition | 58 | 22 |
| No reason string | 0 | 0 |
| Unclassified | 0 | 0 |
| **Total** | **521** | **193** |

## The last run, by the engine’s own skip classes

Run `run-4e12c048-3378-484f-a232-1bcdf1668de2` at 2026-10-10T12:41:39.886Z: 0 checks, 0 applicable ran (0% passed), 0 skipped:

| Engine skip class | Checks | Meaning |
| ----------------- | -----: | ------- |
| notApplicable | 0 | the validator does not apply to that endpoint (by design) |
| recoverable | 0 | needs a fixture, an id or a second principal — a gap to close |
| blockedByDefect | 0 | an open defect stops the check from being meaningful |
| deliberate | 0 | an owner pause or a safety choice |
| environmental | 0 | host or transport trouble this run |

## Retune — a selector that no longer matches, or a defect; Phase 1 drives this to 0 (48)

| Sites | Reason | Where |
| ----: | ------ | ----- |
| 11 | the Contacts tab did not open on this build — needs a codegen re-tune | `tests/e2e/contacts-accessibility.spec.ts:124`, `tests/e2e/contacts-accessibility.spec.ts:155`, `tests/e2e/contacts-accessibility.spec.ts:191`, `tests/e2e/contacts-functional.spec.ts:59` +7 more |
| 3 | advanced search did not open — needs a codegen re-tune | `tests/e2e/contacts-accessibility.spec.ts:182`, `tests/e2e/contacts-functional.spec.ts:195`, `tests/e2e/contacts-security.spec.ts:124` |
| 3 | the Contacts tab did not open on this build | `tests/e2e/contacts-screens-dynamic.spec.ts:66`, `tests/e2e/contacts-screens-dynamic.spec.ts:99`, `tests/e2e/contacts-screens-dynamic.spec.ts:137` |
| 2 | the Create-Group dialog did not open — needs a codegen re-tune | `tests/e2e/contacts-accessibility.spec.ts:203`, `tests/e2e/contacts-functional.spec.ts:152` |
| 2 | the schedule modal did not open on this build — needs a codegen re-tune | `tests/e2e/kall-accessibility.spec.ts:142`, `tests/e2e/kall-security.spec.ts:117` |
| 2 | the Basic Information editor did not open on this build — needs a codegen re-tune | `tests/e2e/profile-functional.spec.ts:97`, `tests/e2e/profile-functional.spec.ts:220` |
| 2 | the Instant Reply editor did not open on this build — needs a codegen re-tune | `tests/e2e/settings-functional.spec.ts:142`, `tests/e2e/settings-security.spec.ts:60` |
| 2 | the fixed probe id did not exist on this host — step 2 never mounted | `tests/e2e/signup-login-accessibility.spec.ts:155`, `tests/e2e/signup-login-screens.spec.ts:136` |
| 2 | the fixed probe id did not exist on this host — the password step (and its Forgot Password link) never mounted | `tests/e2e/signup-login-accessibility.spec.ts:176`, `tests/e2e/signup-login-screens.spec.ts:170` |
| 1 | no chat-header avatar found to click — share the contact display name / avatar selector | `tests/e2e/chat-avatar-session.spec.ts:72` |
| 1 | the Add-contact wizard did not reach the people-search step | `tests/e2e/contacts-accessibility.spec.ts:146` |
| 1 | the add step did not render — needs a codegen re-tune | `tests/e2e/contacts-functional.spec.ts:128` |
| 1 | no addContact was dispatched — the add flow did not complete this build | `tests/e2e/contacts-functional.spec.ts:278` |
| 1 | the modal did not render (may already be covered by the crash-safety test above) | `tests/e2e/global-kool-kall.spec.ts:55` |
| 1 | the Create New Group modal did not open — needs a codegen re-tune | `tests/e2e/group-security.spec.ts:58` |
| 1 | the schedule modal did not open on this build | `tests/e2e/kall-screens-dynamic.spec.ts:85` |
| 1 | could not read a real access token from localStorage to confirm against | `tests/e2e/profile-debug-route.spec.ts:39` |
| 1 | the Contact Information editor did not open on this build — needs a codegen re-tune | `tests/e2e/profile-functional.spec.ts:177` |
| 1 | the mobile field was not present in this editor build | `tests/e2e/profile-functional.spec.ts:227` |
| 1 | the Education/School form did not open on this build — needs a codegen re-tune | `tests/e2e/profile-functional.spec.ts:280` |
| 1 | the Experience form did not open on this build — needs a codegen re-tune | `tests/e2e/profile-functional.spec.ts:306` |
| 1 | the About editor did not open on this build — needs a codegen re-tune | `tests/e2e/profile-functional.spec.ts:328` |
| 1 | the edit form did not open — needs a codegen re-tune | `tests/e2e/settings-business-company-details.spec.ts:71` |
| 1 | the Notification settings panel did not open on this build — needs a codegen re-tune | `tests/e2e/settings-functional.spec.ts:88` |
| 1 | could not read a real member mobile number off the page | `tests/e2e/usermanagement.spec.ts:94` |
| 1 | Submit button not reachable on this tab | `tests/e2e-admin/admin-dead-screens.spec.ts:65` |
| 1 | "Menu Privilege" nav link not reachable this run | `tests/e2e-admin/admin-dead-screens.spec.ts:107` |
| 1 | "Postal Code Library" nav link not reachable this run | `tests/e2e-admin/admin-dead-screens.spec.ts:131` |

## Blocked by a defect — an open bug stops the check from meaning anything (37)

| Sites | Reason | Where |
| ----: | ------ | ----- |
| 3 | scheduledKall did not return a kallID (status …) | `tests/api/kpost/security/kall-legacy-writes-regression-2026-10-07.spec.ts:35`, `tests/api/kpost/security/kall-legacy-writes-regression-2026-10-07.spec.ts:84`, `tests/api/kpost/security/kall-legacy-writes-regression-2026-10-07.spec.ts:130` |
| 3 | kall-initiate did not return a kallID to attack (placed replied …) | `tests/api/kpost/security/kall-object-authorization.spec.ts:58`, `tests/api/kpost/security/kall-object-authorization.spec.ts:152`, `tests/api/kpost/security/kall-object-authorization.spec.ts:420` |
| 3 | send did not return a msgID (replied …) | `tests/api/kpost/security/katchup-idor-regression-2026-10-03.spec.ts:46`, `tests/api/kpost/security/katchup-idor-regression-2026-10-03.spec.ts:161`, `tests/api/kpost/security/katchup-idor-regression-2026-10-03.spec.ts:243` |
| 3 | group-create did not return a groupKpostID (replied …) | `tests/api/kpost/security/katchup-idor-regression-2026-10-03.spec.ts:318`, `tests/api/kpost/security/katchup-idor-regression-2026-10-03.spec.ts:415`, `tests/api/kpost/security/katchup-object-authorization.spec.ts:242` |
| 2 | sendMessage did not return a msgID to attack (send replied …) — activates automatically once one is issued | `tests/api/kpost/security/katchup-object-authorization.spec.ts:66`, `tests/api/kpost/security/katchup-object-authorization.spec.ts:138` |
| 1 | could not get the created location id from the save response | `tests/api/admin/security-cross-tenant-reads.spec.ts:53` |
| 1 | kmail-post-mail did not return a kmailID (…) | `tests/api/kmail/content-idor.spec.ts:86` |
| 1 | Dev-confirmed 2026-09-26: this route is not in use — intentionally unavailable on this build, not a deployment gap. testkmail answers a plain Spring 404 "Not Found" for POST /draft/draftMailMultiPart, consistent with that. Not exercised, by design. | `tests/api/kmail/manage-workflow.spec.ts:246` |
| 1 | Dev-confirmed 2026-09-26: letterhead id "1" IS the shared system default — "other[s] are should be added by user for their own customization." This matches the evidence already on file (getLetterHead marks id 1 `"default":"Y"` at a generic S3 path). So deleting id 1 is confirmed unsafe, exactly as suspected — not a remaining open question. What blocks a live test now is narrower: the KMail OpenAPI contract and workbook register only get-all/get-current/get-template/set-active-by-id/delete-by-id for letterheads — no create/save/upload route a user would call to add their own, so this bench has no way to create a personal letterhead to safely delete instead. Needs the dev to name which endpoint the "add your own" flow actually calls (not documented in the KMAILAPI workbook) before this can be tested end to end; not worked around by deleting the shared default. | `tests/api/kmail/manage-workflow.spec.ts:356` |
| 1 | Dev-confirmed 2026-09-26: this route is not in use — intentionally unavailable on this build, not a deployment gap. Consistent with the plain Spring 404 "route not mapped" it returns. Not exercised, by design. | `tests/api/kmail/manage-workflow.spec.ts:383` |
| 1 | kmail-post-mail did not return a kmailID to attack (send replied …) | `tests/api/kmail/mutation-idor.spec.ts:59` |
| 1 | unOpenedMailCountBySenderID is currently 500 for every account | `tests/api/kmail/reads-workflow.spec.ts:105` |
| 1 | also blocked on #499 (kos-create-doc does not return a docId) independent of deferral | `tests/api/kpost/concurrency/scenarios.spec.ts:231` |
| 1 | katchup-send-multipart is the OLD direct-upload path — owner-confirmed 2026-09-26 that the current client uses the presigned-URL flow instead (aws-katchup-presigned + a direct S3 PUT + katchup-send-message's own uuid field). The route stays registered (generic validator sweep still runs against it) but its attachment-storage behaviour is no longer product- relevant, so it is not asserted on live. The prior finding is closed as #614 WONTFIX, not chased further. See presigned-attachment-workflow.spec.ts for the current, real upload path. | `tests/api/kpost/katchup/attachment-workflow.spec.ts:20` |
| 1 | deactivateAccount is sideEffect:'global' AND otpDependent:'requires' — doubly blocked on live. Disabling the QA account mid-suite would take every other test down with it. Never run for real; only the off-live negative probes touch it. | `tests/api/kpost/profile/device-workflow.spec.ts:124` |
| 1 | kall-scheduled did not return a kallID to attack (scheduled replied …) | `tests/api/kpost/security/kall-object-authorization.spec.ts:286` |
| 1 | send did not return a sharedMessageId (replied …) | `tests/api/kpost/security/katchup-idor-regression-2026-10-03.spec.ts:104` |
| 1 | sendMessage did not return a msgID (status …) | `tests/api/kpost/security/katchup-legacy-recall-regression-2026-10-07.spec.ts:36` |
| 1 | the group send did not return a msgID (replied …) | `tests/api/kpost/security/katchup-object-authorization.spec.ts:264` |
| 1 | createEvent did not return a usable eventID; cannot continue | `tests/api/kpost/security/kdiary-object-authorization.spec.ts:70` |
| 1 | blocked by Bugzilla #499 (kword/create 500) — activates automatically once a docId is issued (create replied …) | `tests/api/kpost/security/kword-object-authorization.spec.ts:70` |
| 1 | blocked by #979 — the session gets force-logged-out from an unrelated background-image 401 within seconds of opening any Katchup conversation, independent of the Share flow itself — see the comment above | `tests/e2e/katchup-digitalcard-share-e2e.spec.ts:61` |
| 1 | the message did not send (see Katchup send defects) — edit state not reachable | `tests/e2e/katchup-functional.spec.ts:180` |
| 1 | blocked by #979-class session fragility — the Contacts tab's own myGroups fetch 401s on this browser session while a fresh token for the same account succeeds, so the group list has no data to show; see the comment above | `tests/e2e/katchup-group-receipts-e2e.spec.ts:135` |
| 1 | KDiary UI has no route/rail entry point in the deployed build — see #812 | `tests/e2e/kdiary.spec.ts:23` |
| 1 | KDiary has no UI entry point to drive — see #812 | `tests/e2e/kdiary.spec.ts:55` |
| 1 | … is genuinely already registered — set a fresh QA_SIGNUP_UI_MOBILE the signup screen's mobile Verify step is broken (a repeat of #720): it misreports this free number as taken, so the OTP modal never opens | `tests/e2e/signup-login-lifecycle.spec.ts:128` |
| 1 | invalid the OTP box just rejected the bypass code — likely test-infra noise (rate-limiting from concurrent heavy traffic on this host, see #721/INVALID), not a real defect; re-run once no other suite is hitting the same API host | `tests/e2e/signup-login-lifecycle.spec.ts:145` |

## Provision — an account, connection, host or secret this machine lacks (238)

| Sites | Reason | Where |
| ----: | ------ | ----- |
| 76 | qa.bench needs a real live account (QA_KPOST_ID) | `tests/e2e/contacts-accessibility.spec.ts:45`, `tests/e2e/contacts-breakage.spec.ts:30`, `tests/e2e/contacts-functional.spec.ts:52`, `tests/e2e/contacts-screens-dynamic.spec.ts:55` +72 more |
| 33 | needs the KPOST_QA connection | `tests/api/kmail/workflow-db.spec.ts:127`, `tests/api/kmail/workflow-db.spec.ts:162`, `tests/api/kpost/contacts/contacts-workflow.spec.ts:63`, `tests/api/kpost/contacts/contacts-workflow.spec.ts:91` +29 more |
| 15 | qa.bench needs both QA accounts | `tests/e2e/contacts.spec.ts:72`, `tests/e2e/group-security.spec.ts:19`, `tests/e2e/katchup-accessibility.spec.ts:25`, `tests/e2e/katchup-attach-send-e2e.spec.ts:22` +11 more |
| 12 | (no reason string) kmailAuthGate() !== undefined, kmailAuthGate() ?? '' | `tests/api/kmail/attachment-idor.spec.ts:40`, `tests/api/kmail/content-idor.spec.ts:48`, `tests/api/kmail/coverage.spec.ts:17`, `tests/api/kmail/credential-disclosure.spec.ts:63` +8 more |
| 9 | account registry says which role is missing (requireAll) | `tests/api/kmail/workflow-db.spec.ts:60`, `tests/api/kpost/contacts/contacts-workflow.spec.ts:39`, `tests/api/kpost/contacts/contacts-workflow.spec.ts:192`, `tests/api/kpost/profile/profile-workflow.spec.ts:38` +5 more |
| 8 | needs the KPOST_QA connection to judge by the row | `tests/api/kmail/mutation-idor.spec.ts:38`, `tests/api/kpost/security/kall-object-authorization.spec.ts:37`, `tests/api/kpost/security/kall-object-authorization.spec.ts:132`, `tests/api/kpost/security/kall-object-authorization.spec.ts:266` +4 more |
| 7 | qa.business needs the BUSINESS_S account (QA_BUSINESS_S_KPOST_ID) | `tests/e2e/kposter.spec.ts:104`, `tests/e2e/screens-business.spec.ts:22`, `tests/e2e/settings-business-bank-details.spec.ts:26`, `tests/e2e/settings-business-company-details.spec.ts:40` +3 more |
| 5 | qa.business.m needs the BUSINESS_M account (QA_BUSINESS_M_KPOST_ID + QA_BUSINESS_M_COMPANY_ID) | `tests/api/admin/feature.spec.ts:104`, `tests/api/admin/reads-workflow.spec.ts:18`, `tests/api/admin/security-cross-tenant-reads.spec.ts:27`, `tests/api/admin/security-probes.spec.ts:52` +1 more |
| 5 | needs two distinct KPost principals | `tests/api/kpost/security/kall-legacy-writes-regression-2026-10-07.spec.ts:16`, `tests/api/kpost/security/kall-object-authorization.spec.ts:527`, `tests/api/kpost/security/katchup-legacy-recall-regression-2026-10-07.spec.ts:17`, `tests/api/kpost/security/katchup-object-authorization.spec.ts:36` +1 more |
| 5 | qa.bench needs both QA accounts (QA_KPOST_ID, QA_VICTIM_KPOST_ID) | `tests/e2e/contacts.spec.ts:18`, `tests/e2e/katchup-actions-more.spec.ts:43`, `tests/e2e/katchup-actions.spec.ts:91`, `tests/e2e/katchup-compose.spec.ts:38` +1 more |
| 4 | qa.bench needs a real account (QA_KPOST_ID) | `tests/e2e/accessibility-axe.spec.ts:29`, `tests/e2e/keyboard-nav.spec.ts:19`, `tests/e2e/network-resilience.spec.ts:19`, `tests/e2e/visual.spec.ts:23` |
| 3 | needs the KPOST_QA connection to assert persistence | `tests/api/kmail/workflow-db.spec.ts:68`, `tests/api/kpost/katchup/workflow-db.spec.ts:72`, `tests/api/kpost/katchup/workflow-db.spec.ts:161` |
| 3 | needs the primary account | `tests/api/kpost/profile/profile-workflow.spec.ts:75`, `tests/api/kpost/profile/profile-workflow.spec.ts:91`, `tests/api/kpost/profile/profile-workflow.spec.ts:142` |
| 3 | qa.bench needs a real live account | `tests/e2e/kall-features.spec.ts:41`, `tests/e2e/kdiary.spec.ts:47`, `tests/e2e/profile-actions.spec.ts:60` |
| 2 | needs three distinct KPost principals | `tests/api/kpost/security/kall-object-authorization.spec.ts:29`, `tests/api/kpost/security/katchup-idor-regression-2026-10-03.spec.ts:23` |
| 2 | needs QA_PASSWORD | `tests/api/kpost/signup-login/security-session.spec.ts:93`, `tests/api/kpost/signup-login/security-session.spec.ts:152` |
| 2 | no KPost principal configured | `tests/api/kpost/signup-login/security-session.spec.ts:108`, `tests/api/kpost/signup-login/security-session.spec.ts:155` |
| 2 | qa.bench qa.bench needs both QA accounts (QA_KPOST_ID, QA_VICTIM_KPOST_ID) | `tests/e2e/katchup-two-session.spec.ts:55`, `tests/e2e/kmail-stored-xss-render.spec.ts:51` |
| 1 | needs both BUSINESS_M and BUSINESS_S principals | `tests/api/admin/security-cross-tenant-reads.spec.ts:26` |
| 1 | needs provisioned qatest_* accounts | `tests/api/kmail/workflow-db.spec.ts:66` |
| 1 | needs the KPOST_QA connection to resolve the real membership id | `tests/api/kpost/group/feature.spec.ts:282` |
| 1 | needs the KPOST_QA connection (DB_HOST/DB_NAME) to prove the account exists | `tests/api/kpost/profile/directory-lookup.spec.ts:69` |
| 1 | set QA_COMPANY_NAME to a real company name to unblock this | `tests/api/kpost/profile/feature.spec.ts:371` |
| 1 | needs the BUSINESS_S admin principal | `tests/api/kpost/security/admin-usermanagement-cross-company.spec.ts:29` |
| 1 | needs a real QA_BUSINESS_M_COMPANY_ID distinct from the attacker's own company | `tests/api/kpost/security/admin-usermanagement-cross-company.spec.ts:31` |
| 1 | qa.p5 needs a real QA_PERSONAL_5_KPOST_ID account not already in the attacker's contacts | `tests/api/kpost/security/kall-object-authorization.spec.ts:532` |
| 1 | needs the personal-5 and victim principals | `tests/api/kpost/security/katchup-object-authorization.spec.ts:198` |
| 1 | needs the personal and personal-3 principals | `tests/api/kpost/security/kdiary-object-authorization.spec.ts:56` |
| 1 | needs two distinct KPost principals (personal + personal-3) | `tests/api/kpost/security/object-authorization.spec.ts:48` |
| 1 | needs the shared QA password to act as a second account | `tests/api/kpost/security/object-authorization.spec.ts:49` |
| 1 | needs the KPOST_QA connection to judge by the row, not the reply | `tests/api/kpost/security/object-authorization.spec.ts:108` |
| 1 | the legacy reference account is absent from this target | `tests/api/kpost/signup-login/domain-policy.spec.ts:207` |
| 1 | no.such.user.9f2a@kpost.in set QA_FORGOT_PASSWORD_KPOST_ID to a spare account whose password may be rewritten; unset, this flow has no safe target | `tests/api/kpost/signup-login/otp-signup-lifecycle.spec.ts:435` |
| 1 | qa.bench needs a real live account and a 2nd account to open a conversation with | `tests/e2e/chat-avatar-session.spec.ts:34` |
| 1 | needs the KPOST_QA connection (DB_HOST/DB_NAME) for the database half | `tests/e2e/cross-layer-login.spec.ts:50` |
| 1 | needs QA_PASSWORD to drive a real login | `tests/e2e/cross-layer-login.spec.ts:54` |
| 1 | qa.bench needs both QA accounts (a group needs at least one other member) | `tests/e2e/group.spec.ts:23` |
| 1 | qa.bench needs the second QA account (QA_VICTIM_KPOST_ID) | `tests/e2e/katchup-continuous.spec.ts:32` |
| 1 | needs 3 QA accounts (QA_KPOST_ID, QA_VICTIM_KPOST_ID, QA_PERSONAL_3_KPOST_ID) | `tests/e2e/katchup-copies.spec.ts:52` |
| 1 | qa.bench qa.p3 needs all three QA accounts (QA_KPOST_ID, QA_VICTIM_KPOST_ID, a configured personal-3 account) | `tests/e2e/katchup-group-receipts-e2e.spec.ts:100` |
| 1 | no.such.user needs a real spare account — set QA_FORGOT_PASSWORD_KPOST_ID (never QA_KPOST_ID) | `tests/e2e/login-forgot-password-lifecycle.spec.ts:43` |
| 1 | needs QA_KPOST_ID | `tests/e2e/login-functional.spec.ts:41` |
| 1 | needs a real live account (QA_VICTIM_KPOST_ID) | `tests/e2e/profile-webview.spec.ts:54` |
| 1 | no safe path to step 2 without a known current password for a spare account | `tests/e2e/settings-change-password.spec.ts:91` |
| 1 | already-exists … was reported as already registered — unexpected on the Business path per source, but handled defensively; set a fresh QA_SIGNUP_BUSINESS_UI_MOBILE | `tests/e2e/signup-business.spec.ts:353` |
| 1 | taken "…" is already registered — set a fresh QA_SIGNUP_BUSINESS_COMPANY_NAME | `tests/e2e/signup-business.spec.ts:385` |
| 1 | taken "…" is already taken — set a fresh QA_SIGNUP_BUSINESS_UNIQUE_NAME | `tests/e2e/signup-business.spec.ts:389` |
| 1 | taken ….… is taken — set a fresh QA_SIGNUP_BUSINESS_DESIGNATION_ID or QA_SIGNUP_BUSINESS_UNIQUE_NAME | `tests/e2e/signup-business.spec.ts:396` |
| 1 | taken … is taken under a different mobile than … — set a fresh QA_SIGNUP_UI_KPOST_ID_LOCAL | `tests/e2e/signup-login-lifecycle.spec.ts:167` |
| 1 | already-exists … is already registered — set a fresh QA_SIGNUP_MOBILE_VIEWPORT_UI_MOBILE | `tests/e2e/signup-mobile-lifecycle.spec.ts:55` |
| 1 | taken … is taken — set a fresh QA_SIGNUP_MOBILE_VIEWPORT_UI_KPOST_ID_LOCAL | `tests/e2e/signup-mobile-lifecycle.spec.ts:79` |
| 1 | qa.bench needs a real, already-registered live account (QA_KPOST_ID) as the known-taken value | `tests/e2e/signup-validation.spec.ts:277` |
| 1 | "Add From Application" tab not reachable with this account\'s role value | `tests/e2e-admin/admin-dead-screens.spec.ts:52` |
| 1 | needs a configured admin host | `tests/e2e-admin/admin-login.spec.ts:17` |
| 1 | an Admin connection has been configured | `tests/framework/admin-db-safety.spec.ts:91` |
| 1 | no local .env on this machine (fresh checkout / CI) | `tests/framework/env-template.spec.ts:65` |
| 1 | needs at least two configured accounts | `tests/framework/kmail-flags.spec.ts:156` |
| 1 | no finding supplied — pass --bug=<file.json> (see the usage block above) | `tests/framework/manual-bug.spec.ts:146` |
| 1 | needs BUGZILLA_URL and BUGZILLA_API_KEY | `tests/framework/ownership.spec.ts:273` |
| 1 | no pre-run snapshot found — run _snapshot-accounts.local.spec.ts first | `tests/framework/_diff-accounts.local.spec.ts:12` |

## Owner decision — gated flows, pauses and safety choices (140)

| Sites | Reason | Where |
| ----: | ------ | ----- |
| 10 | the mobile OTP bypass code only validates on the confirmed OTP test gateway | `tests/e2e/signup-business-medium-large.spec.ts:37`, `tests/e2e/signup-business-medium-large.spec.ts:191`, `tests/e2e/signup-business.spec.ts:331`, `tests/e2e/signup-login-accessibility.spec.ts:211` +6 more |
| 7 | (no reason string) process.env.CONCURRENCY_LIFECYCLE !== 'true', DEFERRED_REASON | `tests/api/kpost/concurrency/scenarios.spec.ts:71`, `tests/api/kpost/concurrency/scenarios.spec.ts:116`, `tests/api/kpost/concurrency/scenarios.spec.ts:230`, `tests/api/kpost/concurrency/scenarios.spec.ts:287` +3 more |
| 6 | writes real messages; set KATCHUP_UI_LIFECYCLE=true | `tests/e2e/katchup-actions-more.spec.ts:39`, `tests/e2e/katchup-actions.spec.ts:87`, `tests/e2e/katchup-copies.spec.ts:48`, `tests/e2e/katchup-forward-subflow-e2e.spec.ts:55` +2 more |
| 5 | needs the BUSINESS_S admin session; set BUSINESS_UI_LIFECYCLE=true | `tests/e2e/screens-business.spec.ts:18`, `tests/e2e/settings-business-bank-details.spec.ts:22`, `tests/e2e/usermanagement-accessibility.spec.ts:35`, `tests/e2e/usermanagement-security.spec.ts:24` +1 more |
| 4 | qa.business needs ADMIN_UI_LIFECYCLE=true, a configured admin host and BUSINESS_M account | `tests/e2e-admin/admin-dead-screens.spec.ts:17`, `tests/e2e-admin/admin-employee-management-pii.spec.ts:27`, `tests/e2e-admin/admin-screens.spec.ts:33`, `tests/e2e-admin/admin-subtabs-health.spec.ts:20` |
| 3 | sends a real message; set KATCHUP_UI_LIFECYCLE=true | `tests/e2e/katchup-compose.spec.ts:72`, `tests/e2e/katchup-digitalcard-share-e2e.spec.ts:49`, `tests/e2e/katchup-secret-message-e2e.spec.ts:15` |
| 3 | sends a real mail; set KMAIL_UI_LIFECYCLE=true | `tests/e2e/kmail-compose.spec.ts:51`, `tests/e2e/kmail-security.spec.ts:19`, `tests/e2e/kmail-stored-xss-render.spec.ts:43` |
| 3 | edits a profile field; set PROFILE_UI_LIFECYCLE=true | `tests/e2e/profile-edit.spec.ts:21`, `tests/e2e/profile-functional.spec.ts:76`, `tests/e2e/profile-security.spec.ts:20` |
| 3 | (no reason string) process.env.SIGNUP_UI_LIFECYCLE !== 'true', 'drives the real signup screen (a mo | `tests/e2e/signup-business-medium-large.spec.ts:187`, `tests/e2e/signup-login-api-handling.spec.ts:26`, `tests/e2e/signup-validation.spec.ts:37` |
| 2 | writes real org structure; set ADMIN_LIFECYCLE=true | `tests/api/admin/feature.spec.ts:100`, `tests/api/admin/write-fuzz-workflow.spec.ts:192` |
| 2 | sends a real mail; set KMAIL_LIFECYCLE=true | `tests/api/kmail/content-idor.spec.ts:49`, `tests/api/kmail/mutation-idor.spec.ts:31` |
| 2 | writes a real message; set KATCHUP_LIFECYCLE=true to run (owner sign-off, flow doc Q4) | `tests/api/kpost/katchup/lifecycle.spec.ts:24`, `tests/api/kpost/katchup/workflow-db.spec.ts:41` |
| 2 | uploads a real file to S3 and sends a real message; set KATCHUP_LIFECYCLE=true and AWS_LIFECYCLE=true | `tests/api/kpost/katchup/presigned-attachment-workflow.spec.ts:24`, `tests/api/kpost/security/katchup-attachment-idor.spec.ts:18` |
| 2 | creates a real diary event; set KDIARY_LIFECYCLE=true | `tests/api/kpost/kdiary/kdiary-reads-workflow.spec.ts:29`, `tests/api/kpost/security/kdiary-object-authorization.spec.ts:52` |
| 2 | sends a real message; set KATCHUP_LIFECYCLE=true | `tests/api/kpost/security/katchup-legacy-recall-regression-2026-10-07.spec.ts:18`, `tests/api/kpost/security/katchup-object-authorization.spec.ts:37` |
| 2 | creates a real, permanent company; set SIGNUP_UI_LIFECYCLE=true | `tests/e2e/signup-business-medium-large.spec.ts:33`, `tests/e2e/signup-business.spec.ts:327` |
| 2 | drives a real mobile OTP to reach this step; set SIGNUP_UI_LIFECYCLE=true | `tests/e2e/signup-login-accessibility.spec.ts:207`, `tests/e2e/signup-login-accessibility.spec.ts:233` |
| 2 | creates a real account and sends a real mail-OTP/e-mail; set SIGNUP_UI_LIFECYCLE=true | `tests/e2e/signup-login-lifecycle.spec.ts:52`, `tests/e2e/signup-mobile-lifecycle.spec.ts:31` |
| 2 | only meaningful when TEST_ENV=production | `tests/framework/live-safety.spec.ts:518`, `tests/framework/live-safety.spec.ts:551` |
| 1 | These four provision/mutate a real, non-reversible external KSMACC account (RolePostingSetUpServiceImpl.sendKPostUserRequest → login.ksmacc.in) — the same class of irreversible external side effect as KOS's metered AI, meant to be held behind a second, explicit, owner-authorized flag (ADMIN_ROLE_POSTING_LIVE) on top of ADMIN_LIFECYCLE. Found 2026-09-26: no code anywhere in this repo actually reads process.env.ADMIN_ROLE_POSTING_LIVE — the flag exists only in a comment, so this flow could not run even with it set. Wiring it up (and running it) needs explicit owner sign-off first, since every run provisions an account with no clean teardown path — not done unilaterally. | `tests/api/admin/needs-id-workflow.spec.ts:24` |
| 1 | uploads a real file to S3 and sends a real mail; set KMAIL_LIFECYCLE=true and AWS_LIFECYCLE=true | `tests/api/kmail/attachment-idor.spec.ts:41` |
| 1 | PERMANENT on this environment (sideEffect:"global", refused by production-guard.ts) AND requires explicit authorization even on a future non-production environment, given it compares real credential material — see docs/scope/blocked-endpoints-rationale.md | `tests/api/kmail/credential-disclosure.spec.ts:69` |
| 1 | sends real mail; set KMAIL_LIFECYCLE=true | `tests/api/kmail/feature.spec.ts:91` |
| 1 | writes real KMail data; set KMAIL_LIFECYCLE=true | `tests/api/kmail/manage-workflow.spec.ts:43` |
| 1 | sensitive: sends a password and returns the account's real mail-send credentials. The endpoint's own definition explicitly says NOT to drive it on live. Recorded as a deliberate gap, not a workaround. | `tests/api/kmail/manage-workflow.spec.ts:373` |
| 1 | writes real KMail settings; set KMAIL_LIFECYCLE=true | `tests/api/kmail/signature-letterhead-workflow.spec.ts:34` |
| 1 | sends real mail on a LIVE mail server; set KMAIL_LIFECYCLE=true to run | `tests/api/kmail/workflow-db.spec.ts:48` |
| 1 | PERMANENT on this environment: addingUserByAdmin/createOrRemoveBackupAdmin/resetPassword/ terminateUser are all sideEffect:"global", which production-guard.ts refuses unconditionally on TEST_ENV=production — needs a non-production environment, not a flag (see docs/scope/blocked-endpoints-rationale.md) | `tests/api/kpost/admin/member-lifecycle.spec.ts:77` |
| 1 | S3 attachment lifecycle; set AWS_LIFECYCLE=true | `tests/api/kpost/aws/feature.spec.ts:41` |
| 1 | testingapi answers 404 "No matching endpoint for this request" for POST saveUnsubscriberDetails, live-verified 2026-09-24. Not run standalone (a 404 there reads  | `tests/api/kpost/common/common-gaps.spec.ts:22` |
| 1 | sideEffect:'global', never cleared for live under any flag — the endpoint's own definition warns a wrong value here is a production incident. Never run for real; the off-live negative probes are the only thing that touches it. | `tests/api/kpost/common/common-gaps.spec.ts:32` |
| 1 | all three need a COMPANY_ADMIN token and two are sideEffect:'global'. The endpoint definitions' own extensive documented investigation (company.api.ts) already traced downloadCompanyLogo's 500-for-every-caller to two candidates (a broken route, or a missing- logo 500-instead-of-404) and explicitly declined to resolve it by uploading a real logo on a token given for reference, "not something to do unasked." That stands unless the owner explicitly authorizes driving these live. | `tests/api/kpost/common/common-gaps.spec.ts:42` |
| 1 | the OTP flows are opened only with OTP_TEST_GATEWAY=true and TEST_DB_MODE=true | `tests/api/kpost/common/forgot-password-limited.spec.ts:16` |
| 1 | writes the block state; set CONTACTS_LIFECYCLE=true | `tests/api/kpost/contacts/contacts-lists-workflow.spec.ts:103` |
| 1 | writes to the address book; set CONTACTS_LIFECYCLE=true | `tests/api/kpost/contacts/feature.spec.ts:50` |
| 1 | creates real groups; set GROUP_LIFECYCLE=true | `tests/api/kpost/group/feature.spec.ts:105` |
| 1 | places/schedules real calls; set KALL_LIFECYCLE=true (owner sign-off, docs/modules/kall-flow.md §5) | `tests/api/kpost/kall/feature.spec.ts:79` |
| 1 | places a real call; set KALL_LIFECYCLE=true (owner sign-off, docs/modules/kall-flow.md §5) | `tests/api/kpost/kall/kall-reads-workflow.spec.ts:69` |
| 1 | schedules a real call; set KALL_LIFECYCLE=true (owner sign-off, docs/modules/kall-flow.md §5) | `tests/api/kpost/kall/kall-reads-workflow.spec.ts:161` |
| 1 | schedules a real repeating call; set KALL_LIFECYCLE=true (owner sign-off, docs/modules/kall-flow.md §5) | `tests/api/kpost/kall/kall-reads-workflow.spec.ts:221` |
| 1 | writes real messages; set KATCHUP_LIFECYCLE=true (owner sign-off, docs/modules/katchup-flow.md §6) | `tests/api/kpost/katchup/feature.spec.ts:99` |
| 1 | sends a real message to get an id to test with; set KATCHUP_LIFECYCLE=true | `tests/api/kpost/katchup/shared-reference-workflow.spec.ts:32` |
| 1 | real third-party seat hold, unconfirmed sandbox — needs explicit authorization | `tests/api/kpost/kbooking/feature.spec.ts:115` |
| 1 | writes real diary events; set KDIARY_LIFECYCLE=true | `tests/api/kpost/kdiary/feature.spec.ts:74` |
| 1 | creates a real diary event and report; set KDIARY_LIFECYCLE=true | `tests/api/kpost/kdiary/kdiary-reads-workflow.spec.ts:99` |
| 1 | writes real KWord docs; set KOS_LIFECYCLE=true | `tests/api/kpost/kos/feature.spec.ts:55` |
| 1 | metered AI calls; set KOS_AI_LIVE=true to run | `tests/api/kpost/kos/feature.spec.ts:208` |
| 1 | testingapi answers 404 "No matching endpoint for this request" for GET /kword/documents/ — the KWord list route is not deployed on this test build (see the endpoint definition's own  | `tests/api/kpost/kos/feature.spec.ts:326` |
| 1 | sendPrimaryDeviceOtp is otpDependent:'sends' with sideEffect:'external' — the SMS/OTP kill-switch in destructiveBlockReason() refuses it against any real host in every mode. Only a confirmed OTP test gateway (OTP_TEST_GATEWAY + TEST_DB_MODE, neither configured here) would open it. Not worked around: sending a real OTP on a normal run would cost money and exhaust the SMS gateway. | `tests/api/kpost/profile/device-workflow.spec.ts:33` |
| 1 | sendPrimaryOrSecondaryDeviceOtp is otpDependent:'sends' with sideEffect:'external' — same SMS/OTP kill-switch as sendPrimaryDeviceOtp above. | `tests/api/kpost/profile/device-workflow.spec.ts:45` |
| 1 | sendAccountDeactivationOtp is otpDependent:'sends' with sideEffect:'external' — same SMS/OTP kill-switch, and it is the OTP step of the account-deactivation flow, which stays blocked in its own right below regardless. | `tests/api/kpost/profile/device-workflow.spec.ts:54` |
| 1 | forgotPasswordOrKpostID is otpDependent:'sends' with sideEffect:'external' — a public (unauthenticated) recovery entry point that sends a real OTP; same kill-switch as the others above. | `tests/api/kpost/profile/device-workflow.spec.ts:64` |
| 1 | setDeviceAsPrimary is otpDependent:'requires' AND matches the guard's isSessionDestroyer pattern — blocked even when OTP_TEST_GATEWAY+TEST_DB_MODE are both set, specifically because it would displace the primary device of the account every other test in the suite is logged in as, breaking every later test in the run. Not worked around: there is no safe way to exercise this against the suite's own live session. | `tests/api/kpost/profile/device-workflow.spec.ts:74` |
| 1 | updateDeviceAsPrimary matches the same isSessionDestroyer pattern as setDeviceAsPrimary above, for the same reason. | `tests/api/kpost/profile/device-workflow.spec.ts:86` |
| 1 | setDeviceAsSecondary matches the isSessionDestroyer pattern (updateDeviceAs*/setDeviceAs*) for the same reason as the primary-device pair above. | `tests/api/kpost/profile/device-workflow.spec.ts:95` |
| 1 | updateDeviceAsSecondary matches the isSessionDestroyer pattern for the same reason as the others above. | `tests/api/kpost/profile/device-workflow.spec.ts:104` |
| 1 | changePassword is sideEffect:'global', never cleared for live under any flag. Running it would change the credential every other suite/test logs in with mid-run — a self-inflicted lockout, not a defect to find. The documented sample is also missing a distinct newPassword field from confirmPassword, which the null/required negative probes already exercise off-live. | `tests/api/kpost/profile/device-workflow.spec.ts:113` |
| 1 | writes real profile data; set PROFILE_LIFECYCLE=true to run | `tests/api/kpost/profile/feature.spec.ts:66` |
| 1 | schedules a real call; set KALL_LIFECYCLE=true | `tests/api/kpost/security/kall-legacy-writes-regression-2026-10-07.spec.ts:17` |
| 1 | places a real call; set KALL_LIFECYCLE=true | `tests/api/kpost/security/kall-object-authorization.spec.ts:30` |
| 1 | sends real messages / creates real groups; set KATCHUP_LIFECYCLE=true | `tests/api/kpost/security/katchup-idor-regression-2026-10-03.spec.ts:24` |
| 1 | creates a real document; set KOS_LIFECYCLE=true | `tests/api/kpost/security/kword-object-authorization.spec.ts:32` |
| 1 | changes account preferences; set SETTINGS_LIFECYCLE=true | `tests/api/kpost/settings/feature.spec.ts:40` |
| 1 | OTP flows run only on a confirmed test gateway: OTP_TEST_GATEWAY=true + TEST_DB_MODE=true | `tests/api/kpost/signup-login/otp-lifecycle-db.spec.ts:45` |
| 1 | needs a real 10-minute wait; set OTP_EXPIRY_WAIT=true to run the expiry boundary | `tests/api/kpost/signup-login/otp-lifecycle-db.spec.ts:464` |
| 1 | OTP/signup flows run only on a confirmed test gateway: OTP_TEST_GATEWAY=true + TEST_DB_MODE=true | `tests/api/kpost/signup-login/otp-signup-lifecycle.spec.ts:23` |
| 1 | mints a permanent company/tenant on the test DB; set BUSINESS_SIGNUP_LIVE=true to run it. Confirmed live 2026-10-02: registers QA Bench API Business Co end to end. | `tests/api/kpost/signup-login/otp-signup-lifecycle.spec.ts:275` |
| 1 | adds a real contact; set CONTACTS_UI_LIFECYCLE=true | `tests/e2e/contacts-functional.spec.ts:216` |
| 1 | blocks a real contact; set CONTACTS_UI_LIFECYCLE=true | `tests/e2e/contacts.spec.ts:68` |
| 1 | creates a real group; set GROUP_UI_LIFECYCLE=true | `tests/e2e/group.spec.ts:19` |
| 1 | creates a real scheduled call; set KALL_UI_LIFECYCLE=true | `tests/e2e/kall-features.spec.ts:37` |
| 1 | drives a real presigned upload + send; set KATCHUP_UI_LIFECYCLE=true | `tests/e2e/katchup-attach-send-e2e.spec.ts:18` |
| 1 | writes real messages; set KATCHUP_UI_LIFECYCLE=true (npm run ui does) | `tests/e2e/katchup-continuous.spec.ts:28` |
| 1 | drives the composer/send; set KATCHUP_UI_LIFECYCLE=true | `tests/e2e/katchup-functional.spec.ts:64` |
| 1 | creates a real group and sends a real message; set KATCHUP_UI_LIFECYCLE=true | `tests/e2e/katchup-group-receipts-e2e.spec.ts:96` |
| 1 | writes real messages between two accounts; set KATCHUP_UI_LIFECYCLE=true | `tests/e2e/katchup-two-session.spec.ts:51` |
| 1 | creates a real diary event; set KDIARY_UI_LIFECYCLE=true | `tests/e2e/kdiary.spec.ts:43` |
| 1 | needs auth2.setup.ts to log STORAGE_STATE_2 in as a real 2nd account; set KATCHUP_UI_LIFECYCLE=true | `tests/e2e/kmail-stored-xss-render.spec.ts:47` |
| 1 | creates and deletes a real document; set KOS_UI_LIFECYCLE=true | `tests/e2e/kword.spec.ts:72` |
| 1 | logs in and out repeatedly; set LOGIN_UI_LIFECYCLE=true | `tests/e2e/login-forgot-password-lifecycle.spec.ts:31` |
| 1 | requesting the reset OTP only validates on the confirmed OTP test gateway | `tests/e2e/login-forgot-password-lifecycle.spec.ts:35` |
| 1 | this genuinely rewrites a real account password; set ALLOW_DESTRUCTIVE_TESTS=true | `tests/e2e/login-forgot-password-lifecycle.spec.ts:39` |
| 1 | ends the session; set LOGIN_UI_LIFECYCLE=true | `tests/e2e/login-session.spec.ts:87` |
| 1 | writes a profile record; set PROFILE_UI_LIFECYCLE=true | `tests/e2e/profile-actions.spec.ts:56` |
| 1 | the mobile field is read-only in this editor — changing it needs its own OTP flow, not testable here | `tests/e2e/profile-functional.spec.ts:233` |
| 1 | writes real company registration details; set BUSINESS_UI_LIFECYCLE=true | `tests/e2e/settings-business-company-details.spec.ts:36` |
| 1 | toggles a real privacy setting; set SETTINGS_UI_LIFECYCLE=true | `tests/e2e/settings-digital-card.spec.ts:15` |
| 1 | toggles a real preference; set SETTINGS_UI_LIFECYCLE=true | `tests/e2e/settings-functional.spec.ts:61` |
| 1 | uploads/removes a real cover image; set SETTINGS_UI_LIFECYCLE=true | `tests/e2e/settings-profile-creation.spec.ts:21` |
| 1 | adds a real Instant Reply; set SETTINGS_UI_LIFECYCLE=true | `tests/e2e/settings-security.spec.ts:21` |
| 1 | changes a real (cosmetic) preference; set SETTINGS_UI_LIFECYCLE=true | `tests/e2e/settings-theme.spec.ts:19` |
| 1 | needs the OTP test gateway; set OTP_TEST_GATEWAY=true TEST_DB_MODE=true | `tests/e2e/signup-business.spec.ts:140` |
| 1 | drives a real mobile OTP to reach these screens; set SIGNUP_UI_LIFECYCLE=true | `tests/e2e/signup-screens-post-otp.spec.ts:50` |
| 1 | visual regression is opt-in: run `npm run ui:visual:update` to baseline, then `npm run ui:visual` | `tests/e2e/visual.spec.ts:19` |
| 1 | manual probe — set CLEANUP_PLAN=true to list orphaned QA records on the primary account, CLEANUP_EXECUTE=true to delete them | `tests/framework/_cleanup-orphaned-records.local.spec.ts:16` |

## Live condition — the application had nothing to test this run (58)

| Sites | Reason | Where |
| ----: | ------ | ----- |
| 11 | invalid the OTP bypass code was rejected this run — re-run | `tests/e2e/login-forgot-password-lifecycle.spec.ts:61`, `tests/e2e/signup-business-medium-large.spec.ts:210`, `tests/e2e/signup-business.spec.ts:160`, `tests/e2e/signup-login-accessibility.spec.ts:223` +7 more |
| 10 | already-exists the random mobile happened to collide — re-run | `tests/e2e/signup-business-medium-large.spec.ts:208`, `tests/e2e/signup-business.spec.ts:158`, `tests/e2e/signup-login-accessibility.spec.ts:221`, `tests/e2e/signup-login-accessibility.spec.ts:248` +6 more |
| 3 | invalid the OTP bypass code was rejected this run — likely transient; re-run | `tests/e2e/signup-business-medium-large.spec.ts:87`, `tests/e2e/signup-business.spec.ts:360`, `tests/e2e/signup-mobile-lifecycle.spec.ts:61` |
| 3 | already-exists the randomly generated mobile number happened to already be registered — vanishingly rare; re-run | `tests/e2e/signup-validation.spec.ts:74`, `tests/e2e/signup-validation.spec.ts:159`, `tests/e2e/signup-validation.spec.ts:204` |
| 3 | invalid the OTP box rejected the bypass code this run — see enterMobileOtp's own doc comment; re-run | `tests/e2e/signup-validation.spec.ts:79`, `tests/e2e/signup-validation.spec.ts:164`, `tests/e2e/signup-validation.spec.ts:209` |
| 2 | needs the mail sent by the first step | `tests/api/kmail/workflow-db.spec.ts:125`, `tests/api/kmail/workflow-db.spec.ts:157` |
| 2 | needs the sent message from the first step | `tests/api/kpost/katchup/workflow-db.spec.ts:115`, `tests/api/kpost/katchup/workflow-db.spec.ts:204` |
| 2 | taken the generated local part happened to collide — re-run | `tests/e2e/signup-login-api-handling.spec.ts:135`, `tests/e2e/signup-validation.spec.ts:231` |
| 1 | getSuspendOrTerminateEmployee always 400s "requestType is Empty or Invalid" (or "...is required" when omitted/null). Tried live 2026-09-26: SUSPEND, TERMINATE, SUSPEND_TERMINATE, ACTIVE, INACTIVE, ALL, Suspended, suspended, SUSPENDED_TERMINATED, BOTH, numeric 0/1/2, boolean true, and alternate field names (status/type/requestStatus/employeeStatus) — none accepted. The originally documented "SUSPENDED" (owner\'s PDF) is also rejected. No frontend source was available to confirm the real value. Needs the dev to confirm the accepted requestType enum before this can be driven live without risking a false CRITICAL. | `tests/api/admin/needs-id-workflow.spec.ts:10` |
| 1 | no transaction row was created to attack | `tests/api/kmail/mutation-idor.spec.ts:68` |
| 1 | no letterhead is available on this account to set | `tests/api/kmail/signature-letterhead-workflow.spec.ts:206` |
| 1 | no real marker available on this account right now (empty recent-activity window) | `tests/api/kpost/dashboard/feature.spec.ts:109` |
| 1 | no city returned for "chennai" right now — cannot chain the search | `tests/api/kpost/kbooking/feature.spec.ts:60` |
| 1 | no reachable destination returned for this source city right now | `tests/api/kpost/kbooking/feature.spec.ts:70` |
| 1 | no trips running on this real route 14 days out right now — nothing to chain tripdetails to | `tests/api/kpost/kbooking/feature.spec.ts:89` |
| 1 | no deactivated accounts on this target to check against | `tests/api/kpost/profile/directory-lookup.spec.ts:220` |
| 1 | image upload failed (replied …) | `tests/api/kpost/security/katchup-idor-regression-2026-10-03.spec.ts:341` |
| 1 | the directory returned no result for the QA mobile — cannot drive add | `tests/e2e/contacts-functional.spec.ts:258` |
| 1 | no merchants returned right now — nothing to click through | `tests/e2e/ecommerce.spec.ts:54` |
| 1 | this account has no message history to click into — nothing to test | `tests/e2e/home-functional.spec.ts:174` |
| 1 | no article loaded to share (live feed may be empty right now) | `tests/e2e/knews.spec.ts:99` |
| 1 | already-exists … was reported as already registered — set a fresh … | `tests/e2e/signup-business-medium-large.spec.ts:81` |
| 1 | taken "…" is already registered — set a fresh … | `tests/e2e/signup-business-medium-large.spec.ts:132` |
| 1 | taken "…" is already taken — set a fresh … | `tests/e2e/signup-business-medium-large.spec.ts:136` |
| 1 | taken ….… is taken — set a fresh … | `tests/e2e/signup-business-medium-large.spec.ts:143` |
| 1 | taken the generated company name happened to collide — re-run | `tests/e2e/signup-business-medium-large.spec.ts:242` |
| 1 | taken the generated unique name happened to collide — re-run | `tests/e2e/signup-business-medium-large.spec.ts:246` |
| 1 | taken the generated KPOST ID happened to collide — re-run | `tests/e2e/signup-business-medium-large.spec.ts:253` |
| 1 | taken the generated id collided — re-run | `tests/e2e/signup-business.spec.ts:284` |
| 1 | no employee was available to pick on the … tab | `tests/e2e-admin/admin-employee-management-pii.spec.ts:54` |

## No reason string — classified from the condition only; Phase 1 gives each one a reason (0)

_None._

## Unclassified — must be 0 (the build fails otherwise) (0)

_None._

