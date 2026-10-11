# KPost API — coverage-by-test-type audit (2026-10-11)

Measured before the owner's manual KPost API run, to answer "do we cover every test type on every
endpoint?". Sources: the live registry (`apiRegistry.find({ suites: ['kpost-api'] })`), the resolved
endpoint policy (`resolveEndpoint`), and the backend route source at `D:\KPOST_PROJECTS\KPOST_V5.0`
(355 distinct `@*Mapping` routes across 36 controllers, comments stripped). Not estimated — dumped.

## Scope counted

- **249** kpost-api endpoints registered; **21** are KOS/KWord (paused by owner) → **228 in scope**.
- 121 writes, 107 reads. productionSafe 83/228. otpDependent 17. sideEffect≠data 29.

## What every registered endpoint already gets

Functional (status / structure / content-type / headers / error-format), authentication
(missing / invalid / expired / malformed token), per-request performance budget, and the response
leak / sensitive-data scan. These need no per-endpoint schema and run on all 228.

## Gap 1 — schema-driven probes skipped where no schema existed — CLOSED 2026-10-11

The negative-input (`request.*`), injection and XSS validators generate their cases from the
endpoint's request/path schema. Where the workbook documented none, they skipped.

| Measure                                             | Before | After |
| --------------------------------------------------- | -----: | ----: |
| body-sending endpoints with no `requestSchema`      |     31 | **0** |
| path-parameter endpoints with no `pathParamsSchema` |     21 | **0** |

Closed with `src/api/schema/sample-schema.ts` — an **open, types-only** schema from each endpoint's
measured payload (accurate types; every field optional + nullable so `required-fields`/`null-value`
cannot false-positive). Enables injection, XSS and wrong-type on the real fields. The 31 request-schema
endpoints: all 9 KDiary writes + 2 KDiary reads, 3 settings notification toggles, katchup
send-message / filter / delete / reference-messages / legacy-recall, kall contact-info /
scheduled-repeat / 3 legacy, contacts block, group remove-member-v1-legacy, admin adding-user (off-live
only), signup-login user-login / login-history / signup / admin-registration. The 21 path endpoints:
common company-name-exist / download-logo, admin user-management / bank-details, 5 katchup downloads +
shared-message-details + messages-subject, 3 group image/details, aws delete-attachment, 3 profile
downloads, profile send-device-otp, 2 kbooking.

**Known noise, not new bugs:** KPost returns `HTTP 200 {"status":"FAILURE"}` for many bad requests
instead of a 4xx. `request.empty-body` and `request.invalid-payload` now fire on these 31 and will
mostly re-surface that single contract class. Injection/XSS (5xx/leak only) and data-type are the clean
signal. The dedupe gate + manual review before filing absorb the 200-FAILURE class.

## Gap 2 — engine AUTHORIZATION category runs 0 checks — N/A-by-design, covered by hand specs

Measured: 0/228 endpoints declare `roles`, `tenantScoped` or `privilegeEscalation`, so the engine's
role / permission / forbidden / cross-resource / privilege-escalation validators all skip. This is
**correct for KPost**: its authorization is per-record ownership (BOLA), not roles/tenants. Wiring the
category was investigated and rejected as brittle — the validators resolve the owner with
`context.principal(role)` (first principal of a role), not the endpoint's `principalKey`, and the first
`COMPANY_ADMIN` (`business-admin`) has no `tenantId`, so probes would run as the wrong account.

The authorization layer is the hand-written BOLA/IDOR specs in `tests/api/kpost/security/`:

| Spec                                                        | Endpoints covered                                                                                                                                  |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| object-authorization                                        | group remove-member, admin-access, edit-name                                                                                                       |
| katchup-object-authorization                                | katchup recall, delete, mark-important, read-status-group                                                                                          |
| katchup-idor-regression / -legacy-recall / -attachment-idor | recall, delete, bulk-info, reference(-messages)-details, messages-by-reference, download, group-download-image, group-details-by-id, legacy-recall |
| kall-object-authorization / kall-legacy-writes-regression   | kall update-status, end-individual, clear-by-ids, reschedule, get-status, contact-info, 3 legacy writes                                            |
| kdiary-object-authorization                                 | kdiary get-event-date, update-event, delete-event                                                                                                  |
| profile-pii-exposure                                        | profile user-profile-by-kpostid                                                                                                                    |
| contacts-global-search-pii                                  | contacts global-search                                                                                                                             |
| admin-usermanagement-cross-company                          | admin user-management-details                                                                                                                      |

**Remaining BOLA gap (documented, not closed):** `profile-delete-{college,school,university,experience,
other-activity}` are keyed by a sub-record id with no owner-vs-stranger spec yet. Closing it needs a
lifecycle that mints a real sub-record id for the owner, then a stranger attempt asserted against the
row — a later pass.

## Gap 3 — ~40 real backend routes registered by no definition — owner decision

The sweep-completeness guard proves every _registered_ endpoint is swept; it cannot see a backend
route that was never registered. The route diff (backend source vs registry) found ~154 unregistered,
of which ~92 are dead V1 twins (`EndPointURL` bakes in `/v2`), ~20 out-of-scope/paused (kword,
kpresentation, knews, ecommerce, razorpay, ai, voice, metadee, crypto, firebase), and ~42 current. Of
the 42, these look frontend-active and real and are referred to the workbook owner before registering:

`/v2/profile/getStorageDetails`, `/v2/profile/setProfilePrivacy`, `/v2/profile/getDesignationOrProfession`,
`/v2/common/getProfession`, `/v2/common/getDesignationByProfessionId`, `/v2/common/country`,
`/v2/common/sendMessage`, `/dairySchedule/deleteReport`, `/v2/dashboard/getKmailDashboardMsg`,
`/v2/dashboard/kallDashboard`, `/v2/signupLogin/fetchPersonalUserDetails`, `/v2/katchup/changeCaption`,
`/v2/katchup/katchupSearch`, `/v2/katchup/patchWorkForGroup`, `/v2/kall/addMembersToKall`.

Registering each needs its real payload from the frontend call site plus a workbook-contract or
`defineUndocumentedKpostEndpoint` decision — not done here because it is per-endpoint evidence work and
some duplicate already-registered `/v2` handlers.

## Not closeable here (owner / environment)

Concurrency (owner-paused), load/soak performance (owner-paused, night-only), OTP flows (#875 bypass
broken on live), rate-limit floods (shared live server), global-side-effect admin/credential writes
(production-guard wall). Each is recorded in `docs/scope/blocked-endpoints-rationale.md`.
