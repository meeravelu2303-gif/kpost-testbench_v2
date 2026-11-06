# KPost API — coverage by test type

**GENERATED — do not edit.** Written by `tests/framework/ledgers/test-types-ledger.spec.ts` (`npm run framework`).
270 KPost API endpoints in scope (KDoc/KOS excluded). Static: what the bench is able to check on
the QA server; whether each check passes is the run report.

| Type | Covered means | Applies to | Covered | Gap | Walled by rule | Coverage |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| contract | a documented response schema (workbook, or backend source confirmed live) is checked | 252 | 246 | 6 | 18 | **97.6%** |
| positive | the normal request is sent on the QA server (by the engine or by a hand-written flow) | 258 | 258 | 0 | 12 | **100%** |
| negative | an endpoint that takes input gets bad input sent to it | 197 | 196 | 1 | 33 | **99.5%** |
| boundary | every text/number input has its limit (from the code or the DB column) probed | 72 | 69 | 3 | 24 | **95.8%** |
| authentication | a login-protected endpoint is sent no, forged, expired and malformed tokens | 186 | 185 | 1 | 38 | **99.5%** |
| authorization | an endpoint that names a record (an id) is tried by a stranger, with the owner's call as control | 102 | 102 | 0 | 3 | **100%** |
| security | injection, XSS, headers and data-exposure probes run on it | 224 | 222 | 2 | 46 | **99.1%** |
| performance | its response time and size are measured on the QA server | 224 | 222 | 2 | 46 | **99.1%** |
| data-integrity | a write is checked in the database (a DB validation, or a DB-asserted spec) | 103 | 100 | 3 | 19 | **97.1%** |
| business-rules | a write has its product rule checked by the end result (a rule spec or a lifecycle) | 112 | 112 | 0 | 11 | **100%** |

"Walled by rule": endpoints the owner rules forbid on a shared QA server, or that no QA account can
ever make succeed (unreachable by design), so they are not counted as gaps. The SMS senders and
session enders are refused by the production guard (`tests/framework/safety/walled-endpoints.spec.ts`);
the others are listed with why.

- `admin-adding-user-by-admin` — walled by owner rule (a real SMS/e-mail, or ends the running session)
- `admin-adding-user-for-reallocate` — a shared-state write, which the engine never sends (CLAUDE.md §3)
- `admin-bank-and-company-details` — every limited input is one the QA guard protects (path.companyID)
- `admin-create-remove-backup-admin` — a shared-state write, which the engine never sends (CLAUDE.md §3)
- `admin-hold-or-release` — a shared-state write, which the engine never sends (CLAUDE.md §3)
- `admin-reset-password` — walled by owner rule (a real SMS/e-mail, or ends the running session)
- `admin-terminate-user` — walled by owner rule (a real SMS/e-mail, or ends the running session)
- `admin-update-bank-account` — a shared-state write, which the engine never sends (CLAUDE.md §3)
- `admin-update-company-details` — a shared-state write, which the engine never sends (CLAUDE.md §3)
- `admin-update-role` — a shared-state write, which the engine never sends (CLAUDE.md §3)
- `admin-user-management-details` — every limited input is one the QA guard protects (path.companyID)
- `common-company-details` — every input is a mobile number, e-mail or company name the QA guard protects
- `common-company-details-by-admin` — every input is a mobile number, e-mail or company name the QA guard protects
- `common-company-name-exist` — every input is a mobile number, e-mail or company name the QA guard protects
- `common-download-company-logo` — every limited input is one the QA guard protects (path.companyID)
- `common-forgot-password-otp` — walled by owner rule (a real SMS/e-mail, or ends the running session)
- `common-forgot-password-update` — a shared-state write, which the engine never sends (CLAUDE.md §3)
- `common-is-company-name-exist` — every input is a mobile number, e-mail or company name the QA guard protects
- `common-mobile-no-exist-in-company` — every limited input is one the QA guard protects (body.mobileNumber)
- `common-remove-company-logo` — a shared-state write, which the engine never sends (CLAUDE.md §3)
- `common-send-otp-to-mail` — every limited input is one the QA guard protects (body.otherEmail)
- `common-update-company-logo` — a shared-state write, which the engine never sends (CLAUDE.md §3)
- `common-update-flutter-app-version` — sets the app-update prompt of every Flutter client
- `common-user-details-by-mobile` — every input is a mobile number, e-mail or company name the QA guard protects
- `common-validate-otp` — every limited input is one the QA guard protects (body.mobileNumber)
- `kall-firebase-notification-test` — walled by owner rule (a real SMS/e-mail, or ends the running session)
- `kall-legacy-cancel-schedule` — unreachable by design: acts on the old TBL_KPOST_KALL_TRACKERS, which no current route writes ("Kall not found" for the owner too)
- `kall-legacy-remove-member` — unreachable by design: acts on the old TBL_KPOST_KALL_SCHEDULE_DETAILS, which no current route writes
- `kall-legacy-set-status` — unreachable by design: acts on the old TBL_KPOST_KALL_TRACKERS, which no current route writes ("Kall not found" for the owner too)
- `katchup-change-caption` — a shared-state write, which the engine never sends (CLAUDE.md §3)
- `katchup-forward-backtrack` — unreachable by design: only the system sender id may call it (KatchupControllerV2 forwardMessageBacktrackByMsgID)
- `katchup-patch-work-for-group` — a one-off data migration only two developer ids may run
- `katchup-upload-multipart-files` — a shared-state write, which the engine never sends (CLAUDE.md §3)
- `katchup-voice-translate` — walled by owner rule (a real SMS/e-mail, or ends the running session)
- `kbooking-block-ticket` — holds a real seat at the booking partner
- `kbooking-update-city-list` — refreshes the RedBus city list of every user
- `knews-admin-feed-disable` — changes the news feed of every user
- `knews-admin-feed-enable` — changes the news feed of every user
- `knews-admin-feed-sync` — changes the news feed of every user
- `profile-change-or-forgot-access-code` — a shared-state write, which the engine never sends (CLAUDE.md §3)
- `profile-change-password` — a shared-state write, which the engine never sends (CLAUDE.md §3)
- `profile-deactivate-account` — walled by owner rule (a real SMS/e-mail, or ends the running session)
- `profile-forgot-password-or-kpostid` — walled by owner rule (a real SMS/e-mail, or ends the running session)
- `profile-kmail-password-patch-work` — resets KMail passwords; only two developer ids may run it
- `profile-send-deactivation-otp` — walled by owner rule (a real SMS/e-mail, or ends the running session)
- `profile-send-device-otp` — walled by owner rule (a real SMS/e-mail, or ends the running session)
- `profile-send-primary-device-otp` — walled by owner rule (a real SMS/e-mail, or ends the running session)
- `profile-set-device-primary` — walled by owner rule (a real SMS/e-mail, or ends the running session)
- `profile-set-device-secondary` — walled by owner rule (a real SMS/e-mail, or ends the running session)
- `profile-update-device-primary` — walled by owner rule (a real SMS/e-mail, or ends the running session)
- `profile-update-device-secondary` — walled by owner rule (a real SMS/e-mail, or ends the running session)
- `signup-login-admin-registration` — a shared-state write, which the engine never sends (CLAUDE.md §3)
- `signup-login-admin-user-login` — its negative probes would send many wrong passwords for the shared business admins (rule 7: one per account per run)
- `signup-login-business-adding-user-public` — overwrites any existing account (no login, no company check)
- `signup-login-kpost-id-exist` — every limited input is one the QA guard protects (body.mobileNumber)
- `signup-login-kpost-id-suggestions` — every limited input is one the QA guard protects (body.mobileNumber)
- `signup-login-logout-all-devices` — a shared-state write, which the engine never sends (CLAUDE.md §3)
- `signup-login-set-access-code` — a shared-state write, which the engine never sends (CLAUDE.md §3)
- `signup-login-signup` — a shared-state write, which the engine never sends (CLAUDE.md §3)

## contract — 97.6% (246/252)

a documented response schema (workbook, or backend source confirmed live) is checked.

**no response schema (workbook silent, source not confirmed live)** (6)

- `common-download-profile-image`
- `signup-login-logout-all-devices`
- `katchup-report-reasons`
- `katchup-report-abuse`
- `katchup-download-thumbnail`
- `knews-feed-articles`

## positive — 100% (258/258)

the normal request is sent on the QA server (by the engine or by a hand-written flow).

No gap.

## negative — 99.5% (196/197)

an endpoint that takes input gets bad input sent to it.

**not cleared to run on the QA server (no productionSafe)** (1)

- `knews-feed-articles`

## boundary — 95.8% (69/72)

every text/number input has its limit (from the code or the DB column) probed.

**Not counted: every input has a cited "no limit"** (114; only compared, a flag, or never read — reasons in `src/api/contract/source/kpost-api.limits.json`)

- `admin-create-remove-backup-admin`
- `admin-display-name-suggestion`
- `admin-kpostid-designation-suggestion`
- `admin-reset-password`
- `admin-terminate-user`
- `admin-update-bank-account`
- `aws-check-attachment`
- `aws-check-attachment-get`
- `aws-delete-attachment`
- `common-company-details`
- `common-company-details-by-admin`
- `common-company-details-by-mobile-and-product`
- `common-company-name-exist`
- `common-country`
- `common-designation`
- `common-domain`
- `common-forgot-password-otp`
- `common-generate-domain-and-unique-name`
- `common-is-company-name-exist`
- `common-kpost-id-using-module`
- `common-languages`
- `common-pincode`
- `common-postal-pincode`
- `common-remove-company-logo`
- `common-unique-name-exist`
- `common-user-details-by-mobile`
- `common-validate-mail-otp`
- `contacts-block`
- `contacts-block-multiple`
- `contacts-delete`
- `contacts-global-search`
- `contacts-import-phone`
- `contacts-search-details`
- `contacts-update-invite`
- `dashboard-home-msgs`
- `dashboard-home-new-msgs`
- `dashboard-kall-history`
- `dashboard-katchup-msg`
- `group-delete`
- `group-details-by-id`
- `group-leave`
- `group-remove-image`
- `group-update-image`
- `kall-contact-info`
- `kall-dashboard`
- `kall-end-individual`
- `kall-fetch-scheduled-repeat`
- `kall-info`
- `kall-join-schedule`
- `katchup-conversation`
- `katchup-download`
- `katchup-download-attachment`
- `katchup-download-from-s3`
- `katchup-download-thumbnail`
- `katchup-filter-message`
- `katchup-generate-thumbnail`
- `katchup-global-search`
- `katchup-legacy-recall-message`
- `katchup-media-streaming`
- `katchup-message-count`
- `katchup-messages-by-reference`
- `katchup-messages-subject`
- `katchup-old-download`
- `katchup-reference-details`
- `katchup-save-messages`
- `katchup-search-message`
- `katchup-search-subject`
- `katchup-voice-translate`
- `kbooking-block-ticket`
- `kbooking-boarding-point`
- `kbooking-city-suggestion`
- `kbooking-destinations`
- `kbooking-trip-details`
- `kbooking-trip-details-v2`
- `kdiary-add-participants`
- `kdiary-delete-event`
- `kdiary-delete-report`
- `kdiary-update-event`
- `knews-publications`
- `knews-sub-categories`
- `profile-advanced-search`
- `profile-auto-search`
- `profile-convert-base64`
- `profile-delete-college`
- `profile-delete-experience`
- `profile-delete-other-activity`
- `profile-delete-school`
- `profile-delete-university`
- `profile-designation-or-profession`
- `profile-digital-card`
- `profile-download-cover`
- `profile-download-full-image`
- `profile-download-image`
- `profile-forgot-password-or-kpostid`
- `profile-is-device-primary`
- `profile-kmail-password-patch-work`
- `profile-save-college`
- `profile-save-experience`
- `profile-save-other-activity`
- `profile-save-school`
- `profile-save-university`
- `profile-send-device-otp`
- `profile-update-about`
- `profile-user-basic-by-kpostid`
- `profile-user-profile-by-kpostid`
- `settings-change-theme`
- `settings-font`
- `settings-kall-notification`
- `settings-katchup-notification`
- `settings-kmail-notification`
- `signup-login-fetch-user-details`
- `signup-login-generate-jwt`
- `signup-login-login-history`
- `signup-login-user-logout`

**Limited inputs the QA guard keeps edge values out of** (23; mobile numbers, e-mails, company names, numeric record ids)

- `admin-adding-user-by-admin` body.companyID
- `admin-adding-user-by-admin` body.mobileNumber
- `admin-bank-and-company-details` path.companyID
- `admin-update-company-details` body.companyName
- `admin-user-management-details` path.companyID
- `common-download-company-logo` path.companyID
- `common-mobile-no-exist` body.mobileNumber
- `common-mobile-no-exist-in-company` body.mobileNumber
- `common-save-enquiry-details` body.companyName
- `common-save-enquiry-details` body.email
- `common-save-enquiry-details` body.mobileNumber
- `common-send-otp` body.mobileNumber
- `common-send-otp-to-mail` body.otherEmail
- `common-update-company-logo` body.companyID
- `common-validate-otp` body.mobileNumber
- `profile-update-basic` body.otherEmail
- `profile-update-contact` body.alternateMobileno
- `signup-login-admin-registration` body.companyName
- `signup-login-admin-registration` body.mobileNumber
- `signup-login-admin-registration` body.otherEmail
- `signup-login-kpost-id-exist` body.mobileNumber
- `signup-login-kpost-id-suggestions` body.mobileNumber
- `signup-login-signup` body.mobileNumber

**every call is refused before any limit: the server reads reportCode while the app and the workbook send reportID (a logged defect)** (1)

- `katchup-report-abuse`

**the route reads only a multipart text part and no client calls it, while the boundary validators mutate JSON bodies** (1)

- `katchup-forward-message`

**not cleared to run on the QA server (no productionSafe)** (1)

- `knews-feed-articles`

## authentication — 99.5% (185/186)

a login-protected endpoint is sent no, forged, expired and malformed tokens.

**not cleared to run on the QA server (no productionSafe)** (1)

- `knews-feed-articles`

## authorization — 100% (102/102)

an endpoint that names a record (an id) is tried by a stranger, with the owner's call as control.

**Not counted: files every signed-in user may read by design** (4; their login check is the authentication type's)

- `profile-download-image` — a user's profile photo, shown wherever their name appears
- `profile-download-full-image` — a user's full-size profile photo, opened from that photo
- `profile-download-cover` — a user's profile cover image, shown on their profile
- `common-download-company-logo` — a company's logo, shown beside its members

**Input keys that end in "id" but name no one's record** (an endpoint whose only ids are these is not counted)

- `sessionID` — the client's own session label (the web app sends 'Web-Reactjs')
- `temporaryMsgID` — the client's own counter for matching its send to the server's answer
- `deviceID` — the caller's own device, sent with its own phone book
- `countryID` — the public country list
- `sourceCityID` — the booking partner's public city list
- `destinationCityID` — the booking partner's public city list
- `tripID` — the booking partner's public trip search result
- `boardingID` — the booking partner's public boarding points of a trip
- `inventoryId` — the booking partner's public trip inventory
- `categoryId` — the public news category list
- `languageId` — the public news language list
- `feedId` — the public news feed list

No gap.

## security — 99.1% (222/224)

injection, XSS, headers and data-exposure probes run on it.

**not cleared to run on the QA server (no productionSafe)** (2)

- `signup-login-generate-jwt`
- `knews-feed-articles`

## performance — 99.1% (222/224)

its response time and size are measured on the QA server.

**not cleared to run on the QA server (no productionSafe)** (2)

- `signup-login-generate-jwt`
- `knews-feed-articles`

## data-integrity — 97.1% (100/103)

a write is checked in the database (a DB validation, or a DB-asserted spec).

**Not counted: writes that store nothing in the database** (5)

- `katchup-generate-thumbnail` — uploads a thumbnail to S3 in the background only (AWSs3ClientServiceImpl.java:934)
- `profile-upload-cover` — writes the cover image to S3 only
- `profile-upload-image-s3` — writes the image to S3 only
- `profile-convert-base64` — converts and uploads to S3 only
- `profile-share-user-details` — a read (its only row is the audit log entry)

**Counted although declared a read: they store a row**

- `signup-login-user-login` — opens a login session row (the KPOSTLogin procedure) and a history row
- `signup-login-admin-user-login` — opens a login session row, as userLogin does
- `aws-generate-presigned` — saves the KMail attachment row (PreSignedURLServiceImpl.java:185) before the upload
- `aws-katchup-presigned` — saves the Katchup attachment row (PreSignedURLServiceImpl.java:293) before the upload

**no database check of what it stored** (3)

- `katchup-forward-message`
- `profile-upload-attachments`
- `profile-update-signature`

## business-rules — 100% (112/112)

a write has its product rule checked by the end result (a rule spec or a lifecycle).

**Not counted: writes no client calls (no screen, no product rule)** (4)

- `katchup-legacy-recall-message` — the pre-V2 /katchup/recallMessage; zero frontend callers (its definition, confirmed 2026-10-05)
- `katchup-forward-message` — the older /v2/katchup/forwardKatchupMessage/; the web app forwards through forwardKatchupMessageNew
- `katchup-change-caption` — a one-off migration (KatchupServiceImpl.captionChange) no client calls; its rewrite is checked by the stored row
- `group-remove-member-v1-legacy` — the pre-V2 /group/removeGroupMember/; the web app calls /v2/group/removeGroupMember (Katchup.js:1064, ServiceURL.js:34)

No gap.
