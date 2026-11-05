# KPost API — coverage by test type

**GENERATED — do not edit.** Written by `tests/framework/ledgers/test-types-ledger.spec.ts` (`npm run framework`).
270 KPost API endpoints in scope (KDoc/KOS excluded). Static: what the bench is able to check on
the QA server; whether each check passes is the run report.

| Type | Covered means | Applies to | Covered | Gap | Walled by rule | Coverage |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| contract | a documented response schema (workbook, or backend source confirmed live) is checked | 252 | 246 | 6 | 18 | **97.6%** |
| positive | the normal request is sent on the QA server (by the engine or by a hand-written flow) | 258 | 258 | 0 | 12 | **100%** |
| negative | an endpoint that takes input gets bad input sent to it | 201 | 175 | 26 | 29 | **87.1%** |
| boundary | every text/number input has its limit (from the code or the DB column) probed | 205 | 19 | 186 | 5 | **9.3%** |
| authentication | a login-protected endpoint is sent no, forged, expired and malformed tokens | 204 | 184 | 20 | 20 | **90.2%** |
| authorization | an endpoint that names a record (an id) is tried by a stranger, with the owner's call as control | 125 | 75 | 50 | 0 | **60%** |
| security | injection, XSS, headers and data-exposure probes run on it | 246 | 224 | 22 | 24 | **91.1%** |
| performance | its response time and size are measured on the QA server | 246 | 224 | 22 | 24 | **91.1%** |
| data-integrity | a write is checked in the database (a DB validation, or a DB-asserted spec) | 157 | 22 | 135 | 0 | **14%** |
| business-rules | a write has its product rule checked by the end result (a rule spec or a lifecycle) | 157 | 129 | 28 | 0 | **82.2%** |

"Walled by rule": endpoints the owner rules forbid on a shared QA server, or that no QA account can
ever make succeed (unreachable by design), so they are not counted as gaps. The SMS senders and
session enders are refused by the production guard (`tests/framework/safety/walled-endpoints.spec.ts`);
the others are listed with why.

- `admin-reset-password` — walled by owner rule (a real SMS/e-mail, or ends the running session)
- `common-company-details` — every input is a mobile number, e-mail or company name the QA guard protects
- `common-company-details-by-admin` — every input is a mobile number, e-mail or company name the QA guard protects
- `common-company-name-exist` — every input is a mobile number, e-mail or company name the QA guard protects
- `common-forgot-password-otp` — walled by owner rule (a real SMS/e-mail, or ends the running session)
- `common-is-company-name-exist` — every input is a mobile number, e-mail or company name the QA guard protects
- `common-send-otp-to-mail` — every input is a mobile number, e-mail or company name the QA guard protects
- `common-update-flutter-app-version` — sets the app-update prompt of every Flutter client
- `common-user-details-by-mobile` — every input is a mobile number, e-mail or company name the QA guard protects
- `contacts-update-invite` — every input is a mobile number, e-mail or company name the QA guard protects
- `kall-firebase-notification-test` — walled by owner rule (a real SMS/e-mail, or ends the running session)
- `kall-legacy-cancel-schedule` — unreachable by design: acts on the old TBL_KPOST_KALL_TRACKERS, which no current route writes ("Kall not found" for the owner too)
- `kall-legacy-remove-member` — unreachable by design: acts on the old TBL_KPOST_KALL_SCHEDULE_DETAILS, which no current route writes
- `kall-legacy-set-status` — unreachable by design: acts on the old TBL_KPOST_KALL_TRACKERS, which no current route writes ("Kall not found" for the owner too)
- `katchup-forward-backtrack` — unreachable by design: only the system sender id may call it (KatchupControllerV2 forwardMessageBacktrackByMsgID)
- `katchup-patch-work-for-group` — a one-off data migration only two developer ids may run
- `katchup-voice-translate` — walled by owner rule (a real SMS/e-mail, or ends the running session)
- `kbooking-block-ticket` — holds a real seat at the booking partner
- `kbooking-update-city-list` — refreshes the RedBus city list of every user
- `knews-admin-feed-disable` — changes the news feed of every user
- `knews-admin-feed-enable` — changes the news feed of every user
- `knews-admin-feed-sync` — changes the news feed of every user
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
- `signup-login-business-adding-user-public` — overwrites any existing account (no login, no company check)

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

## negative — 87.1% (175/201)

an endpoint that takes input gets bad input sent to it.

**not cleared to run on the QA server (no productionSafe)** (19)

- `common-update-company-logo`
- `common-download-company-logo`
- `common-remove-company-logo`
- `admin-adding-user-by-admin`
- `admin-terminate-user`
- `admin-hold-or-release`
- `admin-create-remove-backup-admin`
- `admin-update-company-details`
- `admin-update-bank-account`
- `admin-update-role`
- `signup-login-admin-user-login`
- `signup-login-generate-jwt`
- `signup-login-set-access-code`
- `katchup-reference-messages-details`
- `katchup-change-caption`
- `kdiary-get-event-date`
- `profile-change-or-forgot-access-code`
- `profile-change-password`
- `knews-feed-articles`

**no request schema to mutate** (7)

- `admin-adding-user-for-reallocate`
- `katchup-upload-multipart-files`
- `profile-update-image`
- `profile-upload-cover`
- `profile-upload-attachments`
- `profile-upload-image-s3`
- `profile-update-signature`

## boundary — 9.3% (19/205)

every text/number input has its limit (from the code or the DB column) probed.

**no limit for some fields** (184)

- `common-send-otp` — no limit for body.countryID, body.mobileNumber, body.requestType
- `common-validate-otp` — no limit for body.otp, body.countryID, body.mobileNumber, body.sendDate
- `common-validate-mail-otp` — no limit for body.email, body.sendDate, body.otp
- `common-forgot-password-otp` — no limit for body.kpostID, body.requestType
- `common-forgot-password-update` — no limit for body.kpostID
- `common-pincode` — no limit for body.postalCode
- `common-postal-pincode` — no limit for body.postalCode
- `common-languages` — no limit for body.countryID
- `common-designation` — no limit for body.designation
- `common-country` — no limit for body.countryID
- `common-mobile-no-exist-in-company` — no limit for body.companyID
- `common-user-details-by-mobile` — no limit for body.mobileNumber
- `common-kpost-id-using-module` — no limit for body.module[]
- `common-unique-name-exist` — no limit for body.companyName, body.uniqueName, body.domain
- `common-domain` — no limit for body.countryID, body.userType
- `common-generate-domain-and-unique-name` — no limit for body.kpostID, body.companyName
- `common-is-company-name-exist` — no limit for body.companyName
- `common-company-details` — no limit for body.mobileNumber
- `common-download-profile-image` — no limit for path.kpostID
- `common-company-details-by-admin` — no limit for body.mobileNumber
- `common-company-details-by-mobile-and-product` — no limit for body.mobileNumber, body.productId
- `common-company-name-exist` — no limit for path.companyName
- `common-update-company-logo` — no limit for body.companyID
- `common-remove-company-logo` — no limit for body.companyID
- `common-update-flutter-app-version` — no limit for body.currentVersion
- `common-send-message` — no limit for body.receiver, body.messageType, body.subject, body.actualMessage, body.messageTime, body.serverTime +7
- `admin-kpostid-designation-suggestion` — no limit for body.companyName, body.designation, body.companyID
- `admin-display-name-suggestion` — no limit for body.companyName, body.designation
- `admin-adding-user-by-admin` — no limit for body.companyID, body.requestType
- `admin-terminate-user` — no limit for body.kpostID, body.companyID
- `admin-reset-password` — no limit for body.kpostID, body.companyID, body.mobileNumber, body.countryID, body.userType
- `admin-hold-or-release` — no limit for body.kpostID, body.companyID
- `admin-create-remove-backup-admin` — no limit for body.kpostID, body.companyID
- `admin-update-bank-account` — no limit for body.accountNumber, body.accountHolderName, body.ifscCode, body.bankName, body.branch
- `admin-update-role` — no limit for body.kpostID
- `signup-login-fetch-personal-user-details` — no limit for body.kpostID, body.countryID
- `signup-login-fetch-user-details` — no limit for body.kpostID, body.countryID
- `signup-login-user-login` — no limit for body.login_lattitude, body.login_longitude, body.voip, body.module, body.kpostID, body.logintime
- `signup-login-admin-user-login` — no limit for body.loginRO.countryID, body.loginRO.password, body.loginRO.userType, body.kpostID, body.sessionID, body.deviceType +6
- `signup-login-generate-jwt` — no limit for body.refreshToken
- `signup-login-login-history` — no limit for body.selectedDate
- `signup-login-user-logout` — no limit for body.deviceType, body.deviceIdentity_Primary, body.logouttime
- `signup-login-set-access-code` — no limit for body.kpostID, body.currentPassword
- `signup-login-signup` — no limit for body.createdDate, body.dateOfBirth, body.module, body.email
- `signup-login-admin-registration` — no limit for body.kpostID, body.companyName, body.entity, body.uniqueName, body.firstName, body.lastName +18
- `signup-login-kpost-id-exist` — no limit for body.kpostID, body.firstName, body.lastName
- `signup-login-kpost-id-suggestions` — no limit for body.firstName, body.lastName
- `katchup-messages-subject` — no limit for path.id
- `katchup-conversation` — no limit for body.receiver
- `katchup-message-count` — no limit for body.receiver, body.groupFlag
- `katchup-search-message` — no limit for body.searchMessage
- `katchup-search-subject` — no limit for body.selectedContact, body.searchMessage
- `katchup-filter-message` — no limit for body.selectedContact, body.messageBy
- `katchup-reference-details` — no limit for body.referenceMessageIDList[], body.sourceMsgID
- `katchup-messages-by-reference` — no limit for body.referenceMessageList, body.messageType
- `katchup-global-search` — no limit for body.keyWord
- `katchup-send-message` — no limit for body.messageType, body.subject, body.actualMessage, body.messageTime, body.serverTime, body.status +4
- `katchup-send-multipart` — no limit for body.receiver, body.messageType, body.subject, body.actualMessage, body.messageTime, body.serverTime +5
- `katchup-send-bulk` — no limit for body.receiverList[], body.messageType, body.subject, body.attachmentCaption, body.actualMessage, body.messageTime +5
- `katchup-send-bulk-multipart` — no limit for body.receiverList[], body.messageType, body.subject, body.attachmentCaption, body.actualMessage, body.messageTime +4
- `katchup-send-forward-selected-attachment` — no limit for body.receiver, body.sender, body.messageType, body.subject, body.actualMessage, body.attachmentCaption +7
- `katchup-recall-message` — no limit for body.msgID, body.status
- `katchup-legacy-recall-message` — no limit for body.msgID, body.sender
- `katchup-save-messages` — no limit for body.groupKpostID, body.msgIDs[], body.groupFlag
- `katchup-report-abuse` — no limit for body.reportID[]
- `katchup-forward-message-new` — no limit for body.receiver, body.messageType, body.subject, body.actualMessage, body.attachmentCaption, body.status +5
- `katchup-forward-message` — no limit for body.receiver, body.messageType, body.subject, body.actualMessage, body.attachmentCaption, body.status +5
- `katchup-forward-multiple` — no limit for body.forwardReceiverList[], body.forwardMessageIDList[], body.attachmentCaption, body.uuid[], body.messageType, body.sessionID +1
- `katchup-voice-translate` — no limit for body.uuid
- `katchup-old-download` — no limit for path.uuid
- `katchup-download` — no limit for path.uuid
- `katchup-download-attachment` — no limit for path.uuid
- `katchup-download-from-s3` — no limit for path.uuid
- `katchup-download-thumbnail` — no limit for path.uuid
- `katchup-media-streaming` — no limit for path.uuid
- `katchup-generate-thumbnail` — no limit for body.uuid[]
- `group-create` — no limit for body.groupKpostName
- `group-add-user` — no limit for body.groupID, body.groupKpostID, body.memberDetails[].kpostID, body.memberDetails[].memberDesignation, body.memberDetails[].remarks, body.memberDetails[].createdBy
- `group-remove-member` — no limit for body.memberKpostIdList[], body.groupKpostID
- `group-remove-member-v1-legacy` — no limit for body.groupKpostID
- `group-leave` — no limit for body.id, body.groupID, body.groupKpostID
- `group-admin-access` — no limit for body.kpostIDs[], body.ids[], body.groupID
- `group-edit-name` — no limit for body.groupKpostID, body.groupKpostName
- `group-delete` — no limit for body.groupID
- `group-update-image` — no limit for body.groupKpostID
- `group-remove-image` — no limit for body.groupKpostID
- `group-download-image` — no limit for path.groupKpostID, path.kpostID
- `group-download-full-image` — no limit for path.groupKpostID, path.kpostID
- `group-details-by-id` — no limit for path.groupKpostID
- `kall-dashboard` — no limit for body.kallID
- `kall-info` — no limit for body.contactID
- `kall-contact-info` — no limit for body.contactID
- `kall-fetch-scheduled-repeat` — no limit for body.scheduledStartTime
- `kall-get-status` — no limit for body.sender, body.receiver
- `kall-get-status-by-id` — no limit for body.kpostID
- `kall-initiate` — no limit for body.kallMode, body.kallType, body.kallStatus, body.kallStartTime
- `kall-update-status` — no limit for body.id, body.kallStatus, body.kallID
- `kall-update-sender-receiver-status` — no limit for body.sender, body.kallStatus, body.kallID
- `kall-end-individual` — no limit for body.kallID
- `kall-clear-by-ids` — no limit for body.kallIds[]
- `kall-scheduled` — no limit for body.kallMode, body.subject, body.scheduledStartTime, body.scheduledEndTime, body.repeatType, body.repeatedDate
- `kall-reschedule` — no limit for body.kallMode, body.subject, body.scheduledStartTime, body.scheduledEndTime, body.meetingLink, body.repeatType +2
- `kall-join-schedule` — no limit for body.id, body.kallID
- `kall-end-kool` — no limit for body.id
- `kall-scheduled-repeat` — no limit for body.kallMode, body.subject, body.scheduledStartTime, body.scheduledEndTime, body.meetingLink, body.repeatType +1
- `kall-modify-members` — no limit for body.removingUserIds[]
- `kall-legacy-set-status` — no limit for body.kallID, body.kallStatus, body.kallEndTime
- `kall-legacy-cancel-schedule` — no limit for body.kallID, body.kallStatus, body.kallEndTime
- `contacts-global-search` — no limit for body.search, body.languageList[], body.userTypeList[], body.countryList[]
- `contacts-search-details` — no limit for body.requestType, body.country, body.provienceName, body.state, body.city
- `contacts-add` — no limit for body.firstName, body.lastName
- `contacts-add-multiple` — no limit for body.contactID, body.firstName, body.lastName, body.userType
- `contacts-add-reference` — no limit for body.contactID
- `contacts-delete` — no limit for body.contactID
- `contacts-block` — no limit for body.contactID
- `contacts-block-multiple` — no limit for body.contactIDs[]
- `contacts-import-phone` — no limit for body.deviceID, body.mobileNumber, body.countryCode, body.phoneContacts[].mobileNumber, body.phoneContacts[].countryCode, body.phoneContacts[].name
- `contacts-update-invite` — no limit for body.mobileNumber
- `settings-font` — no limit for body.fontSize, body.fontStyle
- `settings-change-theme` — no limit for body.colourPalette, body.nightModeEnable, body.useLocalSunset&Sunrise, body.syncwithDeviceSetting, body.scheduleTiming, body.kpostLayoutTheme +2
- `settings-katchup-notification` — no limit for body.Message Preview, body.Sound, body.Vibrate, body.Do Not Disturb
- `settings-kmail-notification` — no limit for body.Message Preview, body.Sound, body.Vibrate, body.Do Not Disturb
- `settings-kall-notification` — no limit for body.Message Preview, body.Sound, body.Vibrate, body.Do Not Disturb
- `kdiary-create-event` — no limit for body.title, body.description, body.priority, body.scheduleStartDateAndTime, body.scheduleEndDateAndTime, body.remarksDescription
- `kdiary-create-schedule` — no limit for body.title, body.description, body.priority, body.scheduleStartDateAndTime, body.scheduleEndDateAndTime, body.remarksDescription
- `kdiary-update-event` — no limit for body.title, body.description, body.priority, body.scheduleStartDateAndTime, body.scheduleEndDateAndTime, body.remarksDescription +1
- `kdiary-edit-schedule-event` — no limit for body.title, body.description, body.priority, body.scheduleStartDateAndTime, body.scheduleEndDateAndTime, body.remarksDescription +1
- `kdiary-delete-event` — no limit for body.eventID
- `kdiary-add-participants` — no limit for body.eventID
- `kdiary-update-remarks` — no limit for body.remarks, body.remarksDescription
- `kdiary-save-report` — no limit for body.eventID, body.taskReport
- `kdiary-edit-report` — no limit for body.id, body.taskReport
- `kdiary-delete-report` — no limit for body.id
- `aws-katchup-presigned` — no limit for body.extension
- `aws-check-attachment` — no limit for body.attachmentsUuid[]
- `aws-delete-attachment` — no limit for path.uuid
- `aws-check-attachment-get` — no limit for path.uuid
- `profile-designation-or-profession` — no limit for body.requestType
- `profile-user-profile-by-kpostid` — no limit for body.kpostID
- `profile-user-basic-by-kpostid` — no limit for body.mobileNumber, body.countryID
- `profile-digital-card` — no limit for body.contactID, body.userType
- `profile-auto-search` — no limit for body.fullName, body.country
- `profile-advanced-search` — no limit for body.fullName, body.mobileNumber, body.country
- `profile-is-device-primary` — no limit for body.deviceIdentity_primary
- `profile-download-image` — no limit for path.kpostID
- `profile-download-full-image` — no limit for path.kpostID
- `profile-download-cover` — no limit for path.kpostID
- `profile-kmail-password-patch-work` — no limit for body.kpostIDs[]
- `profile-change-or-forgot-access-code` — no limit for body.currentPassword
- `profile-update-about` — no limit for body.aboutYourself
- `profile-update-basic` — no limit for body.knownLanguages[], body.dateOfBirth
- `profile-update-contact` — no limit for body.alternateMobileno
- `profile-share-user-details` — no limit for body.kpostID
- `profile-save-college` — no limit for body.collegeDetails[].collegeID, body.collegeDetails[].collegeName, body.collegeDetails[].degree, body.collegeDetails[].course, body.collegeDetails[].field, body.collegeDetails[].yearFrom +4
- `profile-save-school` — no limit for body.schoolDetails[].schoolID, body.schoolDetails[].schoolName, body.schoolDetails[].standard, body.schoolDetails[].course, body.schoolDetails[].yearFrom, body.schoolDetails[].yearTo +3
- `profile-save-university` — no limit for body.universityDetails[].universityID, body.universityDetails[].universityName, body.universityDetails[].degree, body.universityDetails[].course, body.universityDetails[].field, body.universityDetails[].yearFrom +4
- `profile-save-other-activity` — no limit for body.otherActivities[].activityID, body.otherActivities[].title, body.otherActivities[].achievements, body.otherActivities[].logoPath, body.otherActivities[].attachmentPath[]
- `profile-save-experience` — no limit for body.experienceDetails[].experienceID, body.experienceDetails[].companyName, body.experienceDetails[].designation, body.experienceDetails[].companyLocation, body.experienceDetails[].achievements, body.experienceDetails[].yearFrom +3
- `profile-delete-college` — no limit for body.collegeID
- `profile-delete-school` — no limit for body.schoolID
- `profile-delete-university` — no limit for body.universityID
- `profile-delete-experience` — no limit for body.experienceID
- `profile-delete-other-activity` — no limit for body.activityID
- `profile-convert-base64` — no limit for body.base64String, body.fileName
- `profile-send-device-otp` — no limit for path.requestType
- `profile-change-password` — no limit for body.oldPassword
- `profile-forgot-password-or-kpostid` — no limit for body.mobileNumber, body.requestType
- `dashboard-kall-history` — no limit for body.serverTime
- `dashboard-home-msgs` — no limit for body.serverTime, body.lastMsgID
- `dashboard-katchup-msg` — no limit for body.serverTime
- `dashboard-home-new-msgs` — no limit for body.firstMsgID, body.serverTime
- `kbooking-city-suggestion` — no limit for path.query
- `kbooking-destinations` — no limit for body.sourceCityID
- `kbooking-available-trips` — no limit for body.travelDate
- `kbooking-trip-details` — no limit for body.tripID
- `kbooking-boarding-point` — no limit for body.boardingID, body.tripID
- `kbooking-trip-details-v2` — no limit for body.inventoryId
- `kbooking-block-ticket` — no limit for body.availableTripId, body.boardingPointId, body.destination, body.inventoryItems[].fare, body.inventoryItems[].passenger.address, body.inventoryItems[].passenger.age +11
- `knews-sub-categories` — no limit for body.categoryId
- `knews-publications` — no limit for body.languageId
- `knews-update-settings` — no limit for body.languageId, body.retentionDays, body.archiveDays
- `knews-feed-articles` — no limit for path.feedId
- `knews-admin-feed-enable` — no limit for path.feedId
- `knews-admin-feed-disable` — no limit for path.feedId

**not cleared to run on the QA server (no productionSafe)** (2)

- `common-download-company-logo`
- `admin-update-company-details`

## authentication — 90.2% (184/204)

a login-protected endpoint is sent no, forged, expired and malformed tokens.

**not cleared to run on the QA server (no productionSafe)** (20)

- `common-update-company-logo`
- `common-download-company-logo`
- `common-remove-company-logo`
- `admin-adding-user-by-admin`
- `admin-terminate-user`
- `admin-hold-or-release`
- `admin-create-remove-backup-admin`
- `admin-update-company-details`
- `admin-update-bank-account`
- `admin-update-role`
- `admin-adding-user-for-reallocate`
- `signup-login-logout-all-devices`
- `signup-login-set-access-code`
- `katchup-reference-messages-details`
- `katchup-change-caption`
- `katchup-upload-multipart-files`
- `kdiary-get-event-date`
- `profile-change-or-forgot-access-code`
- `profile-change-password`
- `knews-feed-articles`

## authorization — 60% (75/125)

an endpoint that names a record (an id) is tried by a stranger, with the owner's call as control.

**takes an id; no cross-user spec names it** (50)

- `common-update-company-logo` — takes body.companyID, body.text.companyID; no cross-user spec names it
- `common-download-company-logo` — takes path.companyID; no cross-user spec names it
- `common-remove-company-logo` — takes body.companyID; no cross-user spec names it
- `admin-reset-password` — takes body.kpostID, body.companyID, body.countryID; no cross-user spec names it
- `katchup-messages-subject` — takes path.id; no cross-user spec names it
- `katchup-deleted-message-ids` — takes path.lastMsgID; no cross-user spec names it
- `katchup-send-multipart` — takes body.sessionID, body.temporaryMsgID; no cross-user spec names it
- `katchup-send-bulk` — takes body.sessionID, body.temporaryMsgID, body.uuid[]; no cross-user spec names it
- `katchup-send-bulk-multipart` — takes body.sessionID, body.temporaryMsgID; no cross-user spec names it
- `katchup-send-forward-selected-attachment` — takes body.sessionID, body.temporaryMsgID, body.uuid[]; no cross-user spec names it
- `katchup-save-messages` — takes body.groupKpostID, body.msgIDs[]; no cross-user spec names it
- `katchup-forward-message-new` — takes body.sessionID, body.temporaryMsgID, body.uuid[]; no cross-user spec names it
- `katchup-forward-multiple` — takes body.uuid[], body.sessionID; no cross-user spec names it
- `katchup-forward-backtrack` — takes body.msgID; no cross-user spec names it
- `katchup-patch-work-for-group` — takes body.msgIDs; no cross-user spec names it
- `katchup-voice-translate` — takes body.uuid; no cross-user spec names it
- `kall-dashboard` — takes body.kallID; no cross-user spec names it
- `kall-info` — takes body.contactID, body.kallID; no cross-user spec names it
- `contacts-add` — takes body.contactID; no cross-user spec names it
- `contacts-add-multiple` — takes body.contactID; no cross-user spec names it
- `contacts-add-reference` — takes body.contactID; no cross-user spec names it
- `contacts-delete` — takes body.contactID; no cross-user spec names it
- `contacts-block` — takes body.contactID; no cross-user spec names it
- `contacts-block-multiple` — takes body.contactIDs[]; no cross-user spec names it
- `contacts-import-phone` — takes body.deviceID; no cross-user spec names it
- `profile-user-profile-by-kpostid` — takes body.kpostID; no cross-user spec names it
- `profile-user-basic-by-kpostid` — takes body.countryID; no cross-user spec names it
- `profile-digital-card` — takes body.contactID; no cross-user spec names it
- `profile-download-image` — takes path.kpostID; no cross-user spec names it
- `profile-download-full-image` — takes path.kpostID; no cross-user spec names it
- `profile-download-cover` — takes path.kpostID; no cross-user spec names it
- `profile-share-user-details` — takes body.kpostID; no cross-user spec names it
- `profile-save-school` — takes body.schoolDetails[].schoolID; no cross-user spec names it
- `profile-save-university` — takes body.universityDetails[].universityID; no cross-user spec names it
- `profile-save-experience` — takes body.experienceDetails[].experienceID; no cross-user spec names it
- `profile-delete-school` — takes body.schoolID; no cross-user spec names it
- `profile-delete-university` — takes body.universityID; no cross-user spec names it
- `profile-delete-experience` — takes body.experienceID; no cross-user spec names it
- `dashboard-home-msgs` — takes body.lastMsgID; no cross-user spec names it
- `dashboard-home-new-msgs` — takes body.firstMsgID; no cross-user spec names it
- `kbooking-destinations` — takes body.sourceCityID; no cross-user spec names it
- `kbooking-available-trips` — takes body.sourceCityID, body.destinationCityID; no cross-user spec names it
- `kbooking-trip-details` — takes body.tripID; no cross-user spec names it
- `kbooking-boarding-point` — takes body.boardingID, body.tripID; no cross-user spec names it
- `kbooking-trip-details-v2` — takes body.inventoryId; no cross-user spec names it
- `knews-sub-categories` — takes body.categoryId; no cross-user spec names it
- `knews-publications` — takes body.languageId; no cross-user spec names it
- `knews-feed-articles` — takes path.feedId; no cross-user spec names it
- `knews-admin-feed-enable` — takes path.feedId; no cross-user spec names it
- `knews-admin-feed-disable` — takes path.feedId; no cross-user spec names it

## security — 91.1% (224/246)

injection, XSS, headers and data-exposure probes run on it.

**not cleared to run on the QA server (no productionSafe)** (22)

- `common-update-company-logo`
- `common-download-company-logo`
- `common-remove-company-logo`
- `admin-adding-user-by-admin`
- `admin-terminate-user`
- `admin-hold-or-release`
- `admin-create-remove-backup-admin`
- `admin-update-company-details`
- `admin-update-bank-account`
- `admin-update-role`
- `admin-adding-user-for-reallocate`
- `signup-login-admin-user-login`
- `signup-login-generate-jwt`
- `signup-login-logout-all-devices`
- `signup-login-set-access-code`
- `katchup-reference-messages-details`
- `katchup-change-caption`
- `katchup-upload-multipart-files`
- `kdiary-get-event-date`
- `profile-change-or-forgot-access-code`
- `profile-change-password`
- `knews-feed-articles`

## performance — 91.1% (224/246)

its response time and size are measured on the QA server.

**not cleared to run on the QA server (no productionSafe)** (22)

- `common-update-company-logo`
- `common-download-company-logo`
- `common-remove-company-logo`
- `admin-adding-user-by-admin`
- `admin-terminate-user`
- `admin-hold-or-release`
- `admin-create-remove-backup-admin`
- `admin-update-company-details`
- `admin-update-bank-account`
- `admin-update-role`
- `admin-adding-user-for-reallocate`
- `signup-login-admin-user-login`
- `signup-login-generate-jwt`
- `signup-login-logout-all-devices`
- `signup-login-set-access-code`
- `katchup-reference-messages-details`
- `katchup-change-caption`
- `katchup-upload-multipart-files`
- `kdiary-get-event-date`
- `profile-change-or-forgot-access-code`
- `profile-change-password`
- `knews-feed-articles`

## data-integrity — 14% (22/157)

a write is checked in the database (a DB validation, or a DB-asserted spec).

**no database check of what it stored** (135)

- `common-forgot-password-otp`
- `common-forgot-password-update`
- `common-mobile-no-exist`
- `common-mobile-no-exist-in-company`
- `common-user-details-by-mobile`
- `common-kpost-id-using-module`
- `common-unique-name-exist`
- `common-domain`
- `common-generate-domain-and-unique-name`
- `common-is-company-name-exist`
- `common-company-details`
- `common-company-details-by-mobile-and-product`
- `common-update-company-logo`
- `common-remove-company-logo`
- `common-update-flutter-app-version`
- `common-save-enquiry-details`
- `common-total-count-by-date`
- `common-send-message`
- `admin-kpostid-designation-suggestion`
- `admin-display-name-suggestion`
- `admin-adding-user-by-admin`
- `admin-terminate-user`
- `admin-reset-password`
- `admin-hold-or-release`
- `admin-create-remove-backup-admin`
- `admin-update-company-details`
- `admin-update-bank-account`
- `admin-update-role`
- `admin-adding-user-for-reallocate`
- `signup-login-fetch-personal-user-details`
- `signup-login-fetch-user-details`
- `signup-login-user-login`
- `signup-login-admin-user-login`
- `signup-login-generate-jwt`
- `signup-login-login-history`
- `signup-login-user-logout`
- `signup-login-set-access-code`
- `signup-login-signup`
- `signup-login-admin-registration`
- `signup-login-kpost-id-suggestions`
- `signup-login-business-adding-user-public`
- `katchup-send-multipart`
- `katchup-send-bulk`
- `katchup-send-bulk-multipart`
- `katchup-send-forward-selected-attachment`
- `katchup-legacy-recall-message`
- `katchup-mark-important`
- `katchup-save-messages`
- `katchup-report-abuse`
- `katchup-forward-message-new`
- `katchup-forward-message`
- `katchup-forward-multiple`
- `katchup-forward-backtrack`
- `katchup-change-caption`
- `katchup-patch-work-for-group`
- `katchup-voice-translate`
- `katchup-upload-multipart-files`
- `katchup-generate-thumbnail`
- `group-create`
- `group-add-user`
- `group-remove-member`
- `group-remove-member-v1-legacy`
- `group-leave`
- `group-admin-access`
- `group-edit-name`
- `group-delete`
- `group-update-image`
- `group-remove-image`
- `kall-update-sender-receiver-status`
- `kall-clear-by-ids`
- `kall-reschedule`
- `kall-scheduled-repeat`
- `kall-modify-members`
- `kall-legacy-set-status`
- `kall-legacy-cancel-schedule`
- `kall-legacy-remove-member`
- `contacts-add-multiple`
- `contacts-block-multiple`
- `contacts-import-phone`
- `contacts-update-invite`
- `settings-kmail-notification`
- `settings-kall-notification`
- `kdiary-create-event`
- `kdiary-create-schedule`
- `kdiary-update-event`
- `kdiary-edit-schedule-event`
- `kdiary-delete-event`
- `kdiary-add-participants`
- `kdiary-update-remarks`
- `kdiary-save-report`
- `kdiary-edit-report`
- `kdiary-delete-report`
- `aws-generate-presigned`
- `aws-katchup-presigned`
- `aws-check-attachment`
- `profile-set-profile-privacy`
- `profile-kmail-password-patch-work`
- `profile-change-or-forgot-access-code`
- `profile-update-designation`
- `profile-update-basic`
- `profile-update-contact`
- `profile-share-user-details`
- `profile-save-college`
- `profile-save-school`
- `profile-save-university`
- `profile-save-other-activity`
- `profile-save-experience`
- `profile-delete-college`
- `profile-delete-school`
- `profile-delete-university`
- `profile-delete-experience`
- `profile-delete-other-activity`
- `profile-update-image`
- `profile-upload-cover`
- `profile-upload-attachments`
- `profile-upload-image-s3`
- `profile-update-signature`
- `profile-convert-base64`
- `profile-set-device-primary`
- `profile-update-device-primary`
- `profile-set-device-secondary`
- `profile-update-device-secondary`
- `profile-change-password`
- `profile-forgot-password-or-kpostid`
- `profile-deactivate-account`
- `kbooking-trip-details`
- `kbooking-boarding-point`
- `kbooking-trip-details-v2`
- `kbooking-block-ticket`
- `knews-sub-categories`
- `knews-publications`
- `knews-update-settings`
- `knews-admin-feed-sync`
- `knews-admin-feed-enable`
- `knews-admin-feed-disable`

## business-rules — 82.2% (129/157)

a write has its product rule checked by the end result (a rule spec or a lifecycle).

**no rule or lifecycle drives it** (28)

- `common-is-company-name-exist`
- `common-update-flutter-app-version`
- `common-send-message`
- `admin-kpostid-designation-suggestion`
- `admin-display-name-suggestion`
- `signup-login-fetch-personal-user-details`
- `signup-login-fetch-user-details`
- `signup-login-admin-user-login`
- `signup-login-generate-jwt`
- `signup-login-login-history`
- `signup-login-kpost-id-suggestions`
- `signup-login-business-adding-user-public`
- `katchup-legacy-recall-message`
- `katchup-forward-message`
- `katchup-change-caption`
- `katchup-patch-work-for-group`
- `katchup-voice-translate`
- `group-remove-member-v1-legacy`
- `kall-legacy-set-status`
- `kall-legacy-cancel-schedule`
- `kall-legacy-remove-member`
- `profile-set-profile-privacy`
- `profile-kmail-password-patch-work`
- `profile-forgot-password-or-kpostid`
- `knews-publications`
- `knews-admin-feed-sync`
- `knews-admin-feed-enable`
- `knews-admin-feed-disable`
