# Endpoint execution matrix — what actually runs, and under which command

**GENERATED — do not edit.** Written by `tests/framework/endpoint-execution-matrix.spec.ts`
(`npm run test:framework`). Edit the endpoint definitions or the specs, not this file.

This answers a different question from `docs/COVERAGE.md`. That ledger measures **definitions
against the documented contract** ("is every workbook row defined?"). This measures
**definitions against executable tests** ("does anything actually run this endpoint?") — the
gap Phase 4I found, where the ledger read 0 uncovered while 64 endpoints had no generated case.

| | Count |
| - | ----: |
| Registered endpoints | **350** |
| — contract matrix (generated validator cases) | 289 |
| — driven by a hand-written application flow | 175 |
| — both layers | 116 |
| — flow only (no generated cases) | 59 |
| — cleared for live (`productionSafe`) | 116 |
| — documented exclusions (not applicable) | 5 |
| — blocked (coverage debt, recovery path below) | 2 |

## Documented exclusions

Deliberately outside the generated matrix. Each is a claim a reviewer can check.

| Endpoint | Reason |
| -------- | ------ |
| `signup-login-user-logout` | session-ending: the engine shares one cached token, so running this through the matrix would log the run out and report 401 everywhere. Excluded by excludeTags in login.spec.ts and pinned by the signup-login coverage guard; driven deliberately by login-flow.spec.ts on its own throwaway session. |
| `common-validate-otp` | otp-consume: needs an OTP this bench cannot obtain outside the test gateway. Excluded by excludeTags in otp.spec.ts; driven by otp-signup-lifecycle.spec.ts on the gateway. |
| `common-validate-mail-otp` | otp-consume: as above, for the mail OTP rather than the mobile one. |
| `signup-login-signup` | mints-account: registration creates a PERMANENT account KPOST cannot delete, so it must never become a fuzz target. Driven once, end to end, by otp-signup-lifecycle.spec.ts. |
| `signup-login-admin-registration` | mints-account: as above, and it mints a whole tenant — a company as well as its admin. |

## Blocked — coverage debt with a recovery path

Not "not applicable": these are endpoints the bench cannot reach today because of a Test Bench
architecture limit. They stay on this list until the recovery path is built.

| Endpoint | Blocker and recovery path |
| -------- | ------------------------- |
| `group-download-image` | A non-destructive GET keyed by a RUNTIME group id. The group lifecycle creates a group and holds its groupKpostID, so the id exists — but `liveWriteAuthorized` in production-guard.ts requires `endpoint.destructive === true`, so `allowLiveWrite` cannot authorise a READ, and the endpoint is not `productionSafe` because a fabricated group id would 404. Kall solves this for its id-keyed reads only because they are POST, which defaults to destructive. RECOVERY: an authorised-read concept (the read equivalent of `allowLiveWrite`) so a flow can drive a read against a resource it just created. Declaring a GET destructive to borrow the write path would misstate the endpoint and is deliberately not done. |
| `group-download-full-image` | Same blocker and same recovery path as `group-download-image`, for the full-size variant. |

## Which command executes what

Derived from `config/run-profiles.json`, so it cannot drift from the runner.

| Profile | Target | Projects | Tag filter | Gated write flows | Cleanup | Filing |
| ------- | ------ | -------- | ---------- | ----------------- | ------- | ------ |
| `admin` | test | api | @admin-api | 1 | spec-managed | command-armed |
| `admin-deep` | test | api | @admin-api | 1 | spec-managed | command-armed |
| `framework` | offline | framework | — | — | not-applicable | never |
| `kmail` | test | api | @kmail-api | 1 | spec-managed | command-armed |
| `kmail-deep` | test | api | @kmail-api | 1 | spec-managed | command-armed |
| `kpost` | test | api | @kpost-api | 9 | spec-managed | command-armed |
| `kpost-deep` | test | api | @kpost-api | 9 | spec-managed | command-armed |
| `mock` | mock | setup, api, framework, integration, chromium | — | — | not-applicable | never |
| `resolve` | test | api | @kpost-api | 9 | spec-managed | resolve-only |
| `ui` | test | setup, chromium, firefox, webkit, admin-ui | — | 11 | spec-managed | command-armed |
| `visual` | test | setup, chromium, firefox, webkit | — | — | not-applicable | never |

**Reading the write classes.** `sideEffect: data` writes are the only ones `WRITE_FUZZ` opens,
and only together with `TEST_DB_MODE`. `global` is never opened by any flag while
`TEST_ENV=production`. `external` / `otpDependent: sends` can never reach a real host at all —
the SMS/OTP kill-switch is the first check in `destructiveBlockReason` and no flag overrides it.

## Per-endpoint

| Suite | Endpoint | Contract | Flow | Live | Write class | Status |
| ----- | -------- | -------- | ---- | ---- | ----------- | ------ |
| admin-api | `admin-country-address-by-pincode`<br>`GET /country/getAddressUsingPincodeAndCountry/{pincode}/{country}` | yes | — | yes | read | COVERED (contract) |
| admin-api | `admin-employee-delete`<br>`POST /employeeDetails/delete` | yes | yes | — | data | COVERED (contract + flow) |
| admin-api | `admin-employee-details`<br>`POST /employeeDetails/getEmployeeDetails` | yes | yes | yes | read | COVERED (contract + flow) |
| admin-api | `admin-employee-save`<br>`POST /employeeDetails/save` | yes | yes | — | data | COVERED (contract + flow) |
| admin-api | `admin-employee-update`<br>`POST /employeeDetails/update` | yes | yes | — | data | COVERED (contract + flow) |
| admin-api | `admin-hr-tier-attribute-by-company`<br>`POST /hrSetUpTierAttribute/getAttributeByCompanyId` | yes | — | yes | read | COVERED (contract) |
| admin-api | `admin-hr-tier-attribute-delete`<br>`POST /hrSetUpTierAttribute/delete` | yes | yes | — | data | COVERED (contract + flow) |
| admin-api | `admin-hr-tier-attribute-save`<br>`POST /hrSetUpTierAttribute/save` | yes | yes | — | data | COVERED (contract + flow) |
| admin-api | `admin-hr-tier-attribute-update`<br>`POST /hrSetUpTierAttribute/update` | yes | yes | — | data | COVERED (contract + flow) |
| admin-api | `admin-hr-tier-variable-delete`<br>`POST /hrSetUpTierVariable/delete` | yes | yes | — | data | COVERED (contract + flow) |
| admin-api | `admin-hr-tier-variable-list`<br>`POST /hrSetUpTierVariable/getHrSetUpTierVariable` | yes | yes | yes | read | COVERED (contract + flow) |
| admin-api | `admin-hr-tier-variable-reporting-hierarchy`<br>`POST /hrSetUpTierVariable/getAllReportingHrTierVariableHierarchy` | yes | yes | — | read | COVERED (contract + flow) |
| admin-api | `admin-hr-tier-variable-save`<br>`POST /hrSetUpTierVariable/save` | yes | yes | — | data | COVERED (contract + flow) |
| admin-api | `admin-hr-tier-variable-update`<br>`POST /hrSetUpTierVariable/update` | yes | yes | — | data | COVERED (contract + flow) |
| admin-api | `admin-role-posting-by-company`<br>`POST /rolePosting/getRolePostingByCompanyId` | yes | — | yes | read | COVERED (contract) |
| admin-api | `admin-role-posting-by-company-and-employee`<br>`POST /rolePosting/getRolePostingByCompanyIdAndEmployeeId` | yes | yes | — | read | COVERED (contract + flow) |
| admin-api | `admin-role-posting-delete`<br>`POST /rolePosting/delete` | yes | — | — | data | COVERED (contract) |
| admin-api | `admin-role-posting-employees`<br>`POST /rolePosting/getEmployeeByCompanyId` | yes | yes | yes | read | COVERED (contract + flow) |
| admin-api | `admin-role-posting-save`<br>`POST /rolePosting/save` | yes | — | — | data | COVERED (contract) |
| admin-api | `admin-role-posting-suspend-terminate`<br>`POST /rolePosting/suspendOrTerminateEmployee` | yes | — | — | data | COVERED (contract) |
| admin-api | `admin-role-posting-suspended-list`<br>`POST /rolePosting/getSuspendOrTerminateEmployee` | yes | — | — | read | COVERED (contract) |
| admin-api | `admin-role-posting-update`<br>`POST /rolePosting/update` | yes | — | — | data | COVERED (contract) |
| admin-api | `admin-workplace-hierarchy`<br>`POST /workplaceHierarchy/getWorkPlaceHierarchy` | yes | yes | — | read | COVERED (contract + flow) |
| admin-api | `admin-workplace-location-all`<br>`POST /location/getAllLocation` | yes | yes | yes | read | COVERED (contract + flow) |
| admin-api | `admin-workplace-location-by-id`<br>`POST /location/getLocationById` | yes | yes | — | read | COVERED (contract + flow) |
| admin-api | `admin-workplace-location-delete`<br>`POST /location/delete` | yes | yes | — | data | COVERED (contract + flow) |
| admin-api | `admin-workplace-location-get`<br>`POST /location/getLocation` | yes | yes | — | read | COVERED (contract + flow) |
| admin-api | `admin-workplace-location-save`<br>`POST /location/save` | yes | yes | — | data | COVERED (contract + flow) |
| admin-api | `admin-workplace-location-update`<br>`POST /location/update` | yes | yes | — | data | COVERED (contract + flow) |
| admin-api | `admin-workplace-tier-attribute-by-company`<br>`POST /adminTierAttribute/getAttributeByCompanyId` | yes | — | yes | read | COVERED (contract) |
| admin-api | `admin-workplace-tier-attribute-delete`<br>`POST /adminTierAttribute/delete` | yes | yes | — | data | COVERED (contract + flow) |
| admin-api | `admin-workplace-tier-attribute-save`<br>`POST /adminTierAttribute/save` | yes | yes | — | data | COVERED (contract + flow) |
| admin-api | `admin-workplace-tier-attribute-update`<br>`POST /adminTierAttribute/update` | yes | yes | — | data | COVERED (contract + flow) |
| admin-api | `admin-workplace-tier-variable-delete`<br>`POST /adminTierVariable/delete` | yes | yes | — | data | COVERED (contract + flow) |
| admin-api | `admin-workplace-tier-variable-list`<br>`POST /adminTierVariable/getAdminTierVariable` | yes | yes | yes | read | COVERED (contract + flow) |
| admin-api | `admin-workplace-tier-variable-reporting-hierarchy`<br>`POST /adminTierVariable/getAllReportingVariableHierarchy` | yes | yes | — | read | COVERED (contract + flow) |
| admin-api | `admin-workplace-tier-variable-save`<br>`POST /adminTierVariable/save` | yes | yes | — | data | COVERED (contract + flow) |
| admin-api | `admin-workplace-tier-variable-update`<br>`POST /adminTierVariable/update` | yes | yes | — | data | COVERED (contract + flow) |
| kmail-api | `kmail-add-od-contact`<br>`POST /testkmail/v2/common/addOtherDomainContacts/` | yes | — | — | data | COVERED (contract) |
| kmail-api | `kmail-all-drafts`<br>`GET /testkmail/v2/draft/getAllDraftMails/` | yes | — | yes | read | COVERED (contract) |
| kmail-api | `kmail-all-letterhead`<br>`GET /testkmail/v2/kmailSetting/getAllLetterHead` | yes | — | yes | read | COVERED (contract) |
| kmail-api | `kmail-all-mail-count`<br>`POST /testkmail/v2/common/getAllMailCount` | yes | — | yes | read | COVERED (contract) |
| kmail-api | `kmail-bulk-dashboard`<br>`POST /testkmail/v2/common/getBulkKmailDashboardMsg` | yes | — | — | read | COVERED (contract) |
| kmail-api | `kmail-bulk-status`<br>`GET /testkmail/v2/sentMail/bulkMail/status/{fromAddress}` | yes | — | — | read | COVERED (contract) |
| kmail-api | `kmail-clear-all-status`<br>`POST /testkmail/v2/common/clearStatusOfAllKmailsContacts` | yes | — | — | data | COVERED (contract) |
| kmail-api | `kmail-clear-status`<br>`POST /testkmail/v2/common/clearStatusOfKmailsContacts/` | yes | — | — | data | COVERED (contract) |
| kmail-api | `kmail-convert-pdf`<br>`POST /testkmail/v2/common/convertMailAsPDF/` | yes | — | — | data | COVERED (contract) |
| kmail-api | `kmail-copies-info`<br>`GET /testkmail/v2/readMail/getCopiesInfo/{kmailID}` | yes | — | — | read | COVERED (contract) |
| kmail-api | `kmail-count-days-limit`<br>`GET /testkmail/v2/kmailSetting/getMailCountDaysLimit` | yes | — | yes | read | COVERED (contract) |
| kmail-api | `kmail-count-days-limit-update`<br>`POST /testkmail/v2/kmailSetting/updateMailCountDaysLimit` | yes | yes | — | data | COVERED (contract + flow) |
| kmail-api | `kmail-credentials`<br>`POST /testkmail/v2/sentMail/getMailCredentials/` | yes | — | — | global | COVERED (contract) |
| kmail-api | `kmail-dashboard`<br>`POST /testkmail/v2/common/getKmailDashboardMsg/` | yes | — | yes | read | COVERED (contract) |
| kmail-api | `kmail-delete`<br>`POST /testkmail/v2/common/deleteKmailWithDeletedBy/` | yes | yes | — | data | COVERED (contract + flow) |
| kmail-api | `kmail-delete-instant-reply`<br>`POST /testkmail/v2/kmailSetting/deleteCustomizedInstantReply` | yes | — | — | data | COVERED (contract) |
| kmail-api | `kmail-delete-letterhead`<br>`POST /testkmail/v2/kmailSetting/deleteLetterHead` | yes | — | — | data | COVERED (contract) |
| kmail-api | `kmail-delete-od-contact`<br>`POST /testkmail/v2/common/deleteOtherDomainContact/` | yes | — | — | data | COVERED (contract) |
| kmail-api | `kmail-delete-saluation`<br>`POST /testkmail/v2/kmailSetting/deleteCustomizedSaluation` | yes | — | — | data | COVERED (contract) |
| kmail-api | `kmail-details-by-id`<br>`POST /testkmail/v2/readMail/getKmailDetailsUsingKmailID` | yes | yes | — | read | COVERED (contract + flow) |
| kmail-api | `kmail-digital-signature`<br>`GET /testkmail/v2/kmailSetting/getDigitalSignature` | yes | — | yes | read | COVERED (contract) |
| kmail-api | `kmail-download-attachment`<br>`GET /testkmail/v2/readMail/download/{uuid}` | yes | — | — | read | COVERED (contract) |
| kmail-api | `kmail-download-od-attachment`<br>`POST /testkmail/v2/readMail/downloadODAttachment` | yes | — | — | data | COVERED (contract) |
| kmail-api | `kmail-download-thumbnail`<br>`GET /testkmail/v2/readMail/downloadThumbnail/{uuid}` | yes | — | — | read | COVERED (contract) |
| kmail-api | `kmail-draft-contacts`<br>`GET /testkmail/v2/draft/getDraftMailsContacts/` | yes | — | yes | read | COVERED (contract) |
| kmail-api | `kmail-draft-content`<br>`POST /testkmail/v2/readMail/draftMailContent` | yes | — | — | read | COVERED (contract) |
| kmail-api | `kmail-draft-delete`<br>`POST /testkmail/v2/draft/deleteDraftMail/` | yes | yes | — | data | COVERED (contract + flow) |
| kmail-api | `kmail-draft-multipart`<br>`POST /testkmail/v2/draft/draftMailMultiPart` | yes | — | — | data | COVERED (contract) |
| kmail-api | `kmail-draft-save`<br>`POST /testkmail/v2/draft/draftMail/` | yes | yes | — | data | COVERED (contract + flow) |
| kmail-api | `kmail-drafts-for-contact`<br>`POST /testkmail/v2/draft/getDraftMailsForSelectedContact/` | yes | — | yes | read | COVERED (contract) |
| kmail-api | `kmail-edit-od-contact`<br>`POST /testkmail/v2/common/editOtherDomainContactsDetails/` | yes | — | — | data | COVERED (contract) |
| kmail-api | `kmail-frequent-contact`<br>`GET /testkmail/v2/common/frequentKmailContact/` | yes | — | yes | read | COVERED (contract) |
| kmail-api | `kmail-group-read-status`<br>`POST /testkmail/v2/common/kmailGroupReadStatus/` | yes | yes | — | read | COVERED (contract + flow) |
| kmail-api | `kmail-important-mails`<br>`POST /testkmail/v2/common/getAllImportantMails/` | yes | — | yes | read | COVERED (contract) |
| kmail-api | `kmail-instant-reply`<br>`GET /testkmail/v2/common/getInstantReply/` | yes | — | yes | read | COVERED (contract) |
| kmail-api | `kmail-known-postbox-contacts`<br>`POST /testkmail/v2/common/knownPostBoxContacts/` | yes | — | yes | read | COVERED (contract) |
| kmail-api | `kmail-letterhead`<br>`GET /testkmail/v2/kmailSetting/getLetterHead` | yes | — | yes | read | COVERED (contract) |
| kmail-api | `kmail-letterhead-template`<br>`GET /testkmail/v2/kmailSetting/getLetterHeadTemplate` | yes | — | yes | read | COVERED (contract) |
| kmail-api | `kmail-mail-content`<br>`POST /testkmail/v2/readMail/sentAndInboxMailContent/` | yes | yes | — | read | COVERED (contract + flow) |
| kmail-api | `kmail-mail-signature`<br>`GET /testkmail/v2/kmailSetting/getMailSignature` | yes | — | yes | read | COVERED (contract) |
| kmail-api | `kmail-media-streaming`<br>`GET /testkmail/v2/readMail/mediaStreaming/{uuid}` | yes | — | — | read | COVERED (contract) |
| kmail-api | `kmail-misc-contacts`<br>`GET /testkmail/v2/common/miscellaneousContacts/` | yes | — | yes | read | COVERED (contract) |
| kmail-api | `kmail-other-domain-mails`<br>`GET /testkmail/v2/sentMail/loadOtherDomainMails/` | yes | — | yes | read | COVERED (contract) |
| kmail-api | `kmail-post-bulk`<br>`POST /testkmail/v2/sentMail/postBulkMail` | yes | — | — | data | COVERED (contract) |
| kmail-api | `kmail-post-mail`<br>`POST /testkmail/v2/sentMail/postMail/` | yes | yes | — | data | COVERED (contract + flow) |
| kmail-api | `kmail-postbox-contacts`<br>`POST /testkmail/v2/common/postBoxContacts/` | yes | — | — | read | COVERED (contract) |
| kmail-api | `kmail-reference-content`<br>`POST /testkmail/v2/readMail/referenceMailContent/` | yes | — | — | read | COVERED (contract) |
| kmail-api | `kmail-reply-not-received`<br>`POST /testkmail/v2/common/replyNotReceived/` | yes | — | yes | read | COVERED (contract) |
| kmail-api | `kmail-reply-not-req-receiver`<br>`POST /testkmail/v2/common/replyNotRequiredByReceiver/` | yes | yes | — | read | COVERED (contract + flow) |
| kmail-api | `kmail-reply-not-req-sender`<br>`POST /testkmail/v2/common/replyNotRequiredBySender/` | yes | yes | — | read | COVERED (contract + flow) |
| kmail-api | `kmail-reply-not-sent`<br>`POST /testkmail/v2/common/replyNotSent/` | yes | — | yes | read | COVERED (contract) |
| kmail-api | `kmail-saluations`<br>`GET /testkmail/v2/common/getSaluations/` | yes | — | yes | read | COVERED (contract) |
| kmail-api | `kmail-save-saluation`<br>`POST /testkmail/v2/kmailSetting/saveOrUpdateCustomizedSaluations` | yes | yes | — | data | COVERED (contract + flow) |
| kmail-api | `kmail-selected-contact-mails`<br>`POST /testkmail/v2/common/selectedContactMails/` | yes | yes | yes | read | COVERED (contract + flow) |
| kmail-api | `kmail-sent-not-opened`<br>`POST /testkmail/v2/common/sentMailNotOpened/` | yes | yes | yes | read | COVERED (contract + flow) |
| kmail-api | `kmail-set-important`<br>`POST /testkmail/v2/common/setKmailAsImportant/` | yes | yes | — | data | COVERED (contract + flow) |
| kmail-api | `kmail-set-instant-reply`<br>`POST /testkmail/v2/kmailSetting/saveOrUpdateCustomizedInstantReply` | yes | yes | — | data | COVERED (contract + flow) |
| kmail-api | `kmail-set-letterhead`<br>`POST /testkmail/v2/kmailSetting/setLetterHead` | yes | — | — | data | COVERED (contract) |
| kmail-api | `kmail-sig-company`<br>`POST /testkmail/v2/kmailSetting/saveOrUpdateMailSignatureCompanyData` | yes | — | — | data | COVERED (contract) |
| kmail-api | `kmail-sig-full`<br>`POST /testkmail/v2/kmailSetting/saveOrUpdateMailSignature` | yes | — | — | data | COVERED (contract) |
| kmail-api | `kmail-sig-graphics`<br>`POST /testkmail/v2/kmailSetting/saveOrUpdateMailSignatureGraphics` | yes | — | — | data | COVERED (contract) |
| kmail-api | `kmail-sig-personal`<br>`POST /testkmail/v2/kmailSetting/saveOrUpdateMailSignaturePersonalData` | yes | yes | — | data | COVERED (contract + flow) |
| kmail-api | `kmail-sig-social`<br>`POST /testkmail/v2/kmailSetting/saveOrUpdateMailSignatureSocialMediaLink` | yes | — | — | data | COVERED (contract) |
| kmail-api | `kmail-sig-style`<br>`POST /testkmail/v2/kmailSetting/saveOrUpdateMailSignatureStyle` | yes | — | — | data | COVERED (contract) |
| kmail-api | `kmail-sig-template`<br>`POST /testkmail/v2/kmailSetting/saveOrUpdateMailSignatureTemplateId` | yes | — | — | data | COVERED (contract) |
| kmail-api | `kmail-status-total-count`<br>`GET /testkmail/v2/common/statusOfKmailsContactsTotalCount/` | yes | — | yes | read | COVERED (contract) |
| kmail-api | `kmail-status-with-count`<br>`POST /testkmail/v2/common/statusOfKmailsContactsWithCount/` | yes | — | yes | read | COVERED (contract) |
| kmail-api | `kmail-subjects`<br>`POST /testkmail/v2/common/mailSubjectSelectedContact/` | yes | — | yes | read | COVERED (contract) |
| kmail-api | `kmail-translation`<br>`POST /testkmail/v2/translator/translation/` | yes | — | yes | read | COVERED (contract) |
| kmail-api | `kmail-unopened-count`<br>`GET /testkmail/v2/common/unOpenedMailCountBySenderID/` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `admin-adding-user-by-admin`<br>`POST /admin/addingUserByAdmin/` | yes | — | — | global | COVERED (contract) |
| kpost-api | `admin-bank-and-company-details`<br>`GET /admin/getBankAndCompanyDetails/{companyID}` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `admin-create-remove-backup-admin`<br>`POST /admin/createOrRemoveBackupAdmin/` | yes | — | — | global | COVERED (contract) |
| kpost-api | `admin-display-name-suggestion`<br>`POST /admin/displayNameSuggestion` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `admin-hold-or-release`<br>`POST /admin/holdOrRelease/` | yes | — | — | global | COVERED (contract) |
| kpost-api | `admin-kpostid-designation-suggestion`<br>`POST /v2/admin/createKpostIDAndDesignationSuggestion` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `admin-reset-password`<br>`POST /admin/resetPassword/` | yes | — | — | global | COVERED (contract) |
| kpost-api | `admin-terminate-user`<br>`POST /admin/terminateUser/` | yes | — | — | global | COVERED (contract) |
| kpost-api | `admin-update-bank-account`<br>`POST /v2/admin/updateBankAccountDetails` | yes | — | — | global | COVERED (contract) |
| kpost-api | `admin-update-company-details`<br>`POST /v2/admin/updateCompanyDetails` | yes | — | — | global | COVERED (contract) |
| kpost-api | `admin-update-role`<br>`POST /v2/admin/updateRole` | yes | — | — | global | COVERED (contract) |
| kpost-api | `admin-user-management-details`<br>`GET /admin/userManagementDetails/{companyID}` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `auth-login`<br>`POST /auth/login` | yes | — | — | mock fixture | COVERED (contract) |
| kpost-api | `aws-check-attachment`<br>`POST /v2/aws/checkAttachmentS3/` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `aws-delete-attachment`<br>`GET /v2/aws/deleteAttachmentFromS3/{uuid}` | yes | yes | — | data | COVERED (contract + flow) |
| kpost-api | `aws-generate-presigned`<br>`POST /v2/aws/generate-presigned-url` | yes | yes | yes | read | COVERED (contract + flow) |
| kpost-api | `aws-katchup-presigned`<br>`POST /v2/aws/katchup/generate-presigned-url` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `common-cities-by-region`<br>`POST /v2/common/getCitiesByRegionId/` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `common-company-details`<br>`POST /v2/common/getCompanyDetails` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `common-company-details-by-admin`<br>`POST /v2/common/getCompanyDetailsByAdmin` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `common-company-details-by-mobile-and-product`<br>`POST /v2/common/getCompanyDetailsByMobileNoAndproductId` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `common-company-name-exist`<br>`GET /v2/common/getCompanyNameExistOnKpostAndKsmacc/{companyName}` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `common-countries`<br>`GET /v2/common/countries` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `common-designation`<br>`POST /v2/common/getDesignation/` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `common-domain`<br>`POST /v2/common/domain/` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `common-download-company-logo`<br>`GET /v2/common/downloadCompanyLogo/{companyID}` | yes | yes | — | read | COVERED (contract + flow) |
| kpost-api | `common-flutter-app-version`<br>`GET /v2/common/getFlutterAppVersion/` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `common-forgot-password-otp`<br>`POST /v2/common/forgotPasswordOTPOrSentKpostIDSms` | yes | yes | — | external / otp:sends | COVERED (contract + flow) |
| kpost-api | `common-forgot-password-update`<br>`POST /v2/common/forgotPasswordUpdate` | yes | yes | — | global / otp:requires | COVERED (contract + flow) |
| kpost-api | `common-generate-domain-and-unique-name`<br>`POST /v2/common/generateDomainAndUniqueName` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `common-kpost-id-using-module`<br>`POST /v2/common/getKpostIdUsingModule` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `common-languages`<br>`POST /v2/common/languages` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `common-mobile-no-exist`<br>`POST /v2/common/mobileNoExist/` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `common-mobile-no-exist-in-company`<br>`POST /v2/common/mobileNoExistInsideCompany/` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `common-ms-status`<br>`GET /v2/common/msStatus/` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `common-pincode`<br>`POST /v2/common/pinCode` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `common-postal-pincode`<br>`POST /v2/common/postalPinCode/` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `common-remove-company-logo`<br>`POST /admin/removeCompanyLogo` | yes | yes | — | global | COVERED (contract + flow) |
| kpost-api | `common-save-enquiry-details`<br>`POST /v2/common/saveEnquiryDetails` | yes | yes | — | data | COVERED (contract + flow) |
| kpost-api | `common-save-unsubscriber-details`<br>`POST /v2/common/saveUnsubscriberDetails` | yes | yes | — | data | COVERED (contract + flow) |
| kpost-api | `common-send-otp`<br>`POST /v2/common/sendOTP/` | yes | yes | — | external / otp:sends | COVERED (contract + flow) |
| kpost-api | `common-send-otp-to-mail`<br>`POST /v2/common/sendOTPtoMail/` | yes | yes | — | external / otp:sends | COVERED (contract + flow) |
| kpost-api | `common-states`<br>`GET /v2/common/getStates/` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `common-total-count-by-date`<br>`POST /v2/common/getTotalCountByDate` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `common-unique-name-exist`<br>`POST /v2/common/uniqueNameExist` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `common-update-company-logo`<br>`POST /v2/common/updateCompanyLogo` | yes | yes | — | global | COVERED (contract + flow) |
| kpost-api | `common-update-flutter-app-version`<br>`POST /v2/common/updateFlutterAppVersion` | yes | yes | — | global | COVERED (contract + flow) |
| kpost-api | `common-user-details-by-mobile`<br>`POST /v2/common/getUserDetailsByMobNo` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `common-validate-mail-otp`<br>`POST /v2/common/validateMailOTP/` | — | yes | — | read | COVERED (flow only) |
| kpost-api | `common-validate-otp`<br>`POST /v2/common/validateOTP/` | — | yes | — | read | COVERED (flow only) |
| kpost-api | `contacts-add`<br>`POST /v2/contacts/addContact` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `contacts-add-multiple`<br>`POST /v2/contacts/addMultipleContact` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `contacts-add-reference`<br>`POST /v2/contacts/addContactReference/` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `contacts-block`<br>`POST /v2/contacts/blockOrUnBlockContact/` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `contacts-block-multiple`<br>`POST /v2/contacts/blockOrUnBlockMultipleContact` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `contacts-blocked`<br>`GET /v2/contacts/getblockContactDetails` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `contacts-delete`<br>`POST /v2/contacts/deleteContact/` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `contacts-global-search`<br>`POST /v2/contacts/globalSearch/` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `contacts-import-phone`<br>`POST /v2/contacts/importPhoneContacts/` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `contacts-imported-phone`<br>`GET /v2/contacts/getImportedPhoneContacts/` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `contacts-my-contacts`<br>`POST /v2/contacts/myContacts/` | yes | yes | yes | read | COVERED (contract + flow) |
| kpost-api | `contacts-my-groups`<br>`POST /v2/contacts/myGroups/` | yes | yes | yes | read | COVERED (contract + flow) |
| kpost-api | `contacts-my-unknown-contacts`<br>`POST /v2/contacts/myUnknownKatchupContacts/` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `contacts-my-unknown-groups`<br>`POST /v2/contacts/myUnknownGroups/` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `contacts-search-details`<br>`POST /v2/contacts/getSearchDetails/` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `contacts-update-invite`<br>`POST /v2/contacts/updateInviteStatus/` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `create-company`<br>`POST /companies` | yes | yes | — | mock fixture | COVERED (contract + flow) |
| kpost-api | `create-user`<br>`POST /users` | yes | yes | — | mock fixture | COVERED (contract + flow) |
| kpost-api | `dashboard-home-msgs`<br>`POST /v2/dashboard/homeDashboardMsgs/` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `dashboard-home-new-msgs`<br>`POST /v2/dashboard/homeDashboardNewMsgs` | yes | yes | — | read | COVERED (contract + flow) |
| kpost-api | `dashboard-katchup-msg`<br>`POST /v2/dashboard/katchupDashboardMsg/` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `delete-user`<br>`DELETE /users/{id}` | yes | yes | — | mock fixture | COVERED (contract + flow) |
| kpost-api | `get-user`<br>`GET /users/{id}` | yes | yes | — | mock fixture | COVERED (contract + flow) |
| kpost-api | `group-add-user`<br>`POST /v2/group/addUserToGroup/` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `group-admin-access`<br>`POST /v2/group/addOrRemoveAdminAccess/` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `group-create`<br>`POST /v2/group/createUserGroup/` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `group-delete`<br>`POST /v2/group/deleteGroup` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `group-download-full-image`<br>`GET /v2/group/downloadGroupFullProfileImage/{groupKpostID}/{kpostID}` | — | — | — | read | BLOCKED (recovery path documented) |
| kpost-api | `group-download-image`<br>`GET /v2/group/downloadGroupProfileImage/{groupKpostID}/{kpostID}` | — | — | — | read | BLOCKED (recovery path documented) |
| kpost-api | `group-edit-name`<br>`POST /v2/group/editGroupName` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `group-leave`<br>`POST /v2/group/leaveFromGroup/` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `group-remove-image`<br>`POST /v2/group/removeGroupProfileImage` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `group-remove-member`<br>`POST /v2/group/removeGroupMember/` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `group-update-image`<br>`POST /v2/group/updateGroupProfileImage/` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `health-check`<br>`GET /health` | yes | — | — | mock fixture | COVERED (contract) |
| kpost-api | `kall-clear-by-ids`<br>`POST /v2/kall/clearKallBykallIds` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `kall-clear-history`<br>`GET /v2/kall/clearKallHistory` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `kall-contact-info`<br>`POST /v2/kall/contactInfo/` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `kall-dashboard`<br>`POST /v2/kall/kallDashboard` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `kall-end-individual`<br>`POST /v2/kall/endIndividualKall/` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `kall-end-kool`<br>`POST /v2/kall/endKoolKall` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `kall-fetch-scheduled-repeat`<br>`POST /v2/kall/fetchScheduledRepeatKall` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `kall-frequent-contacts`<br>`GET /v2/kall/frequentKallContacts` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `kall-get-status`<br>`POST /v2/kall/getKallStatus` | yes | yes | — | read | COVERED (contract + flow) |
| kpost-api | `kall-get-status-by-id`<br>`POST /v2/kall/getKallStatusUsingKallID` | yes | yes | — | read | COVERED (contract + flow) |
| kpost-api | `kall-info`<br>`POST /v2/kall/kallInfo` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `kall-initiate`<br>`POST /v2/kall/initiateKall` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `kall-join-schedule`<br>`POST /v2/kall/joinScheduleKall` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `kall-modify-members`<br>`POST /v2/kall/modifyKallMembers` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `kall-reschedule`<br>`POST /v2/kall/reScheduleKall` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `kall-scheduled`<br>`POST /v2/kall/scheduledKall` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `kall-scheduled-repeat`<br>`POST /v2/kall/scheduledRepeatKall` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `kall-today-kool`<br>`GET /v2/kall/todayKoolKall/` | yes | yes | yes | read | COVERED (contract + flow) |
| kpost-api | `kall-update-sender-receiver-status`<br>`POST /v2/kall/updateSenderAndReceiverKallStatus` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `kall-update-status`<br>`POST /v2/kall/updateKallStatus` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `katchup-all-report-msg`<br>`GET /v2/katchup/getAllReportMsg` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `katchup-bulk-message-info`<br>`POST /v2/katchup/getBulkMessageInfo/` | yes | — | — | read | COVERED (contract) |
| kpost-api | `katchup-conversation`<br>`POST /v2/katchup/katchupMessagesForSelectedContactID/` | yes | yes | yes | read | COVERED (contract + flow) |
| kpost-api | `katchup-delete-message`<br>`POST /v2/katchup/deleteKatchUpMessage/` | yes | yes | — | data | COVERED (contract + flow) |
| kpost-api | `katchup-download`<br>`GET /v2/katchup/download/{uuid}` | yes | — | — | read | COVERED (contract) |
| kpost-api | `katchup-download-attachment`<br>`GET /v2/katchup/downloadAttachment/{uuid}` | yes | — | — | read | COVERED (contract) |
| kpost-api | `katchup-download-from-s3`<br>`GET /v2/katchup/downloadFromS3/{uuid}` | yes | — | — | read | COVERED (contract) |
| kpost-api | `katchup-download-thumbnail`<br>`GET /v2/katchup/downloadThumbnail/{uuid}` | yes | — | — | read | COVERED (contract) |
| kpost-api | `katchup-filter-message`<br>`POST /v2/katchup/filterKatchUpMessage/` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `katchup-forward-backtrack`<br>`POST /v2/katchup/forwardMessageBacktrackByMsgID` | yes | — | — | read | COVERED (contract) |
| kpost-api | `katchup-forward-message`<br>`POST /v2/katchup/forwardKatchupMessage/` | yes | yes | — | data | COVERED (contract + flow) |
| kpost-api | `katchup-forward-message-new`<br>`POST /v2/katchup/forwardKatchupMessageNew` | yes | yes | — | data | COVERED (contract + flow) |
| kpost-api | `katchup-forward-multiple`<br>`POST /v2/katchup/forwardKatchupMultipleMsgs` | yes | yes | — | data | COVERED (contract + flow) |
| kpost-api | `katchup-frequent-contacts`<br>`GET /v2/katchup/frequentlyAccessContacts` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `katchup-generate-thumbnail`<br>`POST /v2/katchup/generateThumbnailUsingUUID` | yes | — | — | data | COVERED (contract) |
| kpost-api | `katchup-mark-important`<br>`POST /v2/katchup/markOrUnmarkImportantMessage/` | yes | yes | — | data | COVERED (contract + flow) |
| kpost-api | `katchup-media-streaming`<br>`GET /v2/katchup/mediaStreaming/{uuid}` | yes | — | — | read | COVERED (contract) |
| kpost-api | `katchup-message-count`<br>`POST /v2/katchup/messageCountBetweenSenderAndReceiver/` | yes | yes | yes | read | COVERED (contract + flow) |
| kpost-api | `katchup-messages-by-reference`<br>`POST /v2/katchup/getMessagesByReferenceMessageList` | yes | — | — | read | COVERED (contract) |
| kpost-api | `katchup-messages-subject`<br>`GET /v2/katchup/getKatchupMessagesSubject` | yes | — | — | read | COVERED (contract) |
| kpost-api | `katchup-read-status-group`<br>`POST /v2/katchup/getReadStatusGroupMessage/` | yes | yes | — | read | COVERED (contract + flow) |
| kpost-api | `katchup-recall-message`<br>`POST /v2/katchup/recallMessage/` | yes | yes | — | data | COVERED (contract + flow) |
| kpost-api | `katchup-reference-details`<br>`POST /v2/katchup/getReferenceMSGDetails/` | yes | — | — | read | COVERED (contract) |
| kpost-api | `katchup-report-abuse`<br>`POST /v2/katchup/reportAbuse` | yes | yes | — | data | COVERED (contract + flow) |
| kpost-api | `katchup-save-messages`<br>`POST /v2/katchup/saveKatchupMessages/` | yes | yes | — | data | COVERED (contract + flow) |
| kpost-api | `katchup-search-message`<br>`POST /v2/katchup/searchKatchUpMessage/` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `katchup-search-subject`<br>`POST /v2/katchup/searchKatchUpMessageSubject` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `katchup-send-bulk`<br>`POST /v2/katchup/sendBulkKatchupMsg` | yes | yes | — | data | COVERED (contract + flow) |
| kpost-api | `katchup-send-bulk-multipart`<br>`POST /v2/katchup/sendBulkKatchupMsgMultiPart/` | yes | yes | — | data | COVERED (contract + flow) |
| kpost-api | `katchup-send-forward-selected-attachment`<br>`POST /v2/katchup/sendMessageForForwardSelectedAttachment` | yes | yes | — | data | COVERED (contract + flow) |
| kpost-api | `katchup-send-message`<br>`POST /v2/katchup/sendMessage/` | yes | yes | — | data | COVERED (contract + flow) |
| kpost-api | `katchup-send-multipart`<br>`POST /v2/katchup/sendKatchupMsgMultiPart/` | yes | yes | — | data | COVERED (contract + flow) |
| kpost-api | `katchup-shared-message-details`<br>`GET /v2/katchup/getSharedMessageDetails/{msgID}` | yes | — | — | read | COVERED (contract) |
| kpost-api | `katchup-shared-message-info`<br>`POST /v2/katchup/getSharedMessageInfo/` | yes | — | — | read | COVERED (contract) |
| kpost-api | `katchup-unopened-count`<br>`GET /v2/katchup/getUnopenedMessagesCount/` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `katchup-unopened-total-count`<br>`GET /v2/katchup/getUnopenedMessagesAndKmailsTotalCount/` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `kdiary-add-participants`<br>`POST /dairySchedule/addparticipants` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `kdiary-create-event`<br>`POST /dairySchedule/createEvent` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `kdiary-create-schedule`<br>`POST /dairySchedule/createSchedule` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `kdiary-delete-event`<br>`POST /dairySchedule/deleteEvent` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `kdiary-edit-report`<br>`POST /dairySchedule/editReport` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `kdiary-edit-schedule-event`<br>`POST /dairySchedule/editScheduleEvent` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `kdiary-get-event-date`<br>`POST /dairySchedule/getEventDate` | yes | — | — | read | COVERED (contract) |
| kpost-api | `kdiary-get-event-selected-date`<br>`POST /dairySchedule/getEventSelectedDate` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `kdiary-get-events`<br>`GET /dairySchedule/getEvents` | yes | yes | yes | read | COVERED (contract + flow) |
| kpost-api | `kdiary-save-report`<br>`POST /dairySchedule/saveReport` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `kdiary-today-report`<br>`GET /dairySchedule/getTodayReport` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `kdiary-today-schedules`<br>`GET /dairySchedule/getTodaySchedules` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `kdiary-update-event`<br>`POST /dairySchedule/updateEvent` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `kdiary-update-remarks`<br>`POST /dairySchedule/updateScheduleRemarks` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `kos-access-activity`<br>`GET /kword/getAccessActivity/{docId}` | yes | yes | — | read | COVERED (contract + flow) |
| kpost-api | `kos-ai-assist`<br>`POST /ai/messageAssist` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `kos-ai-chat`<br>`POST /ai/chatResponse` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `kos-ai-messages`<br>`GET /ai/messages/{sessionId}` | yes | — | — | read | COVERED (contract) |
| kpost-api | `kos-ai-sessions`<br>`GET /ai/sessions` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `kos-convert-to-kad`<br>`POST /kword/isConvertToKad` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `kos-create-doc`<br>`POST /kword/create` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `kos-delete-doc`<br>`GET /kword/delete` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `kos-delete-heading`<br>`POST /kword/deleteHeading` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `kos-exit-doc`<br>`GET /kword/exitDocument/{docId}` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `kos-get-document`<br>`GET /kword/documents/{docId}` | yes | yes | — | read | COVERED (contract + flow) |
| kpost-api | `kos-join-doc`<br>`POST /kword/joinDocument` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `kos-list-documents`<br>`GET /kword/documents/` | yes | — | — | read | COVERED (contract) |
| kpost-api | `kos-presence`<br>`GET /kword/presence/{docId}` | yes | yes | — | read | COVERED (contract + flow) |
| kpost-api | `kos-revisions`<br>`GET /kword/getAllRevision/{docId}` | yes | yes | — | read | COVERED (contract + flow) |
| kpost-api | `kos-save-content`<br>`POST /kword/saveContent` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `kos-share-doc`<br>`POST /kword/share` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `kos-update-doc`<br>`POST /kword/update` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `list-dictionary-terms`<br>`GET /dictionary/terms` | yes | — | — | mock fixture | COVERED (contract) |
| kpost-api | `list-users`<br>`GET /users` | yes | — | — | mock fixture | COVERED (contract) |
| kpost-api | `profile-advanced-search`<br>`POST /v2/profile/advancedSearch/` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `profile-auto-search`<br>`POST /v2/profile/autoSearchWithName/` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `profile-change-password`<br>`POST /v2/profile/changePassword` | yes | yes | — | global | COVERED (contract + flow) |
| kpost-api | `profile-convert-base64`<br>`POST /v2/profile/convertBase64ToImage` | yes | yes | — | data | COVERED (contract + flow) |
| kpost-api | `profile-deactivate-account`<br>`POST /v2/profile/deactivateAccount/` | yes | yes | — | global / otp:requires | COVERED (contract + flow) |
| kpost-api | `profile-delete-college`<br>`POST /v2/profile/deleteCollegeDetail` | yes | yes | — | data | COVERED (contract + flow) |
| kpost-api | `profile-delete-experience`<br>`POST /v2/profile/deleteExperienceDetail` | yes | — | — | data | COVERED (contract) |
| kpost-api | `profile-delete-school`<br>`POST /v2/profile/deleteSchoolDetail` | yes | — | — | data | COVERED (contract) |
| kpost-api | `profile-delete-university`<br>`POST /v2/profile/deleteUniversityDetail` | yes | — | — | data | COVERED (contract) |
| kpost-api | `profile-digital-card`<br>`POST /v2/profile/getDigitalCard/` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `profile-download-cover`<br>`GET /v2/profile/downloadCoverImage/{kpostID}` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `profile-download-full-image`<br>`GET /v2/profile/downloadFullProfileImage/{kpostID}` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `profile-download-image`<br>`GET /v2/profile/downloadProfileImage/{kpostID}` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `profile-fetch-user-details`<br>`GET /v2/profile/fetchUserDetails/` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `profile-forgot-password-or-kpostid`<br>`POST /v2/profile/forgotPasswordOrKpostID/` | yes | yes | — | external / otp:sends | COVERED (contract + flow) |
| kpost-api | `profile-get-languages`<br>`GET /v2/profile/getlanguages/` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `profile-get-signature`<br>`GET /v2/profile/getSignatureImage` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `profile-is-device-primary`<br>`GET /v2/profile/isDevicePrimaryOrNot/` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `profile-remove-cover`<br>`GET /v2/profile/removeCoverImage/` | yes | yes | — | data | COVERED (contract + flow) |
| kpost-api | `profile-remove-image`<br>`GET /v2/profile/removeProfileImage/` | yes | yes | — | data | COVERED (contract + flow) |
| kpost-api | `profile-save-college`<br>`POST /v2/profile/saveOrUpdateCollegeDetails/` | yes | yes | — | data | COVERED (contract + flow) |
| kpost-api | `profile-save-experience`<br>`POST /v2/profile/saveOrUpdateExperienceDetails/` | yes | — | — | data | COVERED (contract) |
| kpost-api | `profile-save-other-activity`<br>`POST /v2/profile/saveOrUpdateOtherActivity/` | yes | — | — | data | COVERED (contract) |
| kpost-api | `profile-save-school`<br>`POST /v2/profile/saveOrUpdateSchoolDetails/` | yes | — | — | data | COVERED (contract) |
| kpost-api | `profile-save-university`<br>`POST /v2/profile/saveOrUpdateUniversityDetails/` | yes | — | — | data | COVERED (contract) |
| kpost-api | `profile-send-deactivation-otp`<br>`GET /v2/profile/sendAccountDeactivationOtp/` | yes | — | — | external / otp:sends | COVERED (contract) |
| kpost-api | `profile-send-device-otp`<br>`GET /v2/profile/sendPrimaryOrSecondaryDeviceOtp/{requestType}` | yes | — | — | external / otp:sends | COVERED (contract) |
| kpost-api | `profile-send-primary-device-otp`<br>`GET /v2/profile/sendPrimaryDeviceOtp/` | yes | — | — | external / otp:sends | COVERED (contract) |
| kpost-api | `profile-set-device-primary`<br>`POST /v2/profile/setDeviceAsPrimary/` | yes | yes | — | global / otp:requires | COVERED (contract + flow) |
| kpost-api | `profile-set-device-secondary`<br>`POST /v2/profile/setDeviceAsSecondary` | yes | — | — | global / otp:requires | COVERED (contract) |
| kpost-api | `profile-share-user-details`<br>`POST /v2/profile/shareUserDetails` | yes | yes | — | data | COVERED (contract + flow) |
| kpost-api | `profile-update-about`<br>`POST /v2/profile/updateAboutYourself/` | yes | yes | — | data | COVERED (contract + flow) |
| kpost-api | `profile-update-basic`<br>`POST /v2/profile/updateBasicInformation/` | yes | yes | — | data | COVERED (contract + flow) |
| kpost-api | `profile-update-contact`<br>`POST /v2/profile/updateContactInformation/` | yes | yes | — | data | COVERED (contract + flow) |
| kpost-api | `profile-update-designation`<br>`POST /v2/profile/updateDesignation` | yes | yes | — | data | COVERED (contract + flow) |
| kpost-api | `profile-update-device-primary`<br>`POST /v2/profile/updateDeviceAsPrimary/` | yes | — | — | global / otp:requires | COVERED (contract) |
| kpost-api | `profile-update-device-secondary`<br>`POST /v2/profile/updateDeviceAsSecondary` | yes | — | — | global / otp:requires | COVERED (contract) |
| kpost-api | `profile-update-image`<br>`POST /v2/profile/updateProfileImage/` | yes | yes | — | data | COVERED (contract + flow) |
| kpost-api | `profile-update-privacy`<br>`POST /v2/profile/updatePrivacySettingDetails/` | yes | yes | — | data | COVERED (contract + flow) |
| kpost-api | `profile-update-signature`<br>`POST /v2/profile/updateSignatureImage` | yes | yes | — | data | COVERED (contract + flow) |
| kpost-api | `profile-upload-attachments`<br>`POST /v2/profile/uploadProfileAttachments` | yes | yes | — | data | COVERED (contract + flow) |
| kpost-api | `profile-upload-cover`<br>`POST /v2/profile/uploadCoverImage/` | yes | yes | — | data | COVERED (contract + flow) |
| kpost-api | `profile-upload-image-s3`<br>`POST /v2/profile/uploadImageToS3` | yes | yes | — | data | COVERED (contract + flow) |
| kpost-api | `profile-user-basic-by-kpostid`<br>`POST /v2/profile/getUserBasicDetailsUsingKpostID` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `profile-user-profile-by-kpostid`<br>`POST /v2/profile/getUserProfileUsingKpostID/` | yes | yes | yes | read | COVERED (contract + flow) |
| kpost-api | `settings-change-theme`<br>`POST /generalSetting/changeTheme` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `settings-font`<br>`POST /generalSetting/fontSetting` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `settings-get-notifications`<br>`GET /generalSetting/getAllNotification` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `settings-get-personalize`<br>`GET /generalSetting/getPersonalize` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `settings-kall-notification`<br>`POST /generalSetting/kallNotification` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `settings-katchup-notification`<br>`POST /generalSetting/katchupNotification` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `settings-kmail-notification`<br>`POST /generalSetting/kmailNotification` | — | yes | — | data | COVERED (flow only) |
| kpost-api | `signup-login-active-session`<br>`GET /v2/signupLogin/getActiveSession` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `signup-login-admin-registration`<br>`POST /v2/signupLogin/adminRegistration/` | — | yes | — | global / otp:requires | COVERED (flow only) |
| kpost-api | `signup-login-admin-user-login`<br>`POST /signupLoginForMediumAndLarge/adminUserLogin` | yes | — | — | read | COVERED (contract) |
| kpost-api | `signup-login-fetch-user-details`<br>`POST /v2/signupLogin/fetchUserDetails/` | yes | yes | yes | read | COVERED (contract + flow) |
| kpost-api | `signup-login-generate-jwt`<br>`POST /v2/signupLogin/generateJWTokens/` | yes | — | — | read | COVERED (contract) |
| kpost-api | `signup-login-kpost-id-exist`<br>`POST /v2/signupLogin/kpostIdExist/` | yes | yes | yes | read | COVERED (contract + flow) |
| kpost-api | `signup-login-kpost-id-suggestions`<br>`POST /v2/signupLogin/kpostIDsuggestionList/` | yes | yes | yes | read | COVERED (contract + flow) |
| kpost-api | `signup-login-login-history`<br>`POST /v2/signupLogin/getLoginHistory` | yes | — | yes | read | COVERED (contract) |
| kpost-api | `signup-login-logout-all-devices`<br>`GET /v2/signupLogin/userLogoutFromAllDevices/` | yes | yes | — | global | COVERED (contract + flow) |
| kpost-api | `signup-login-set-access-code`<br>`POST /v2/signupLogin/setAccessCode` | yes | yes | — | global | COVERED (contract + flow) |
| kpost-api | `signup-login-signup`<br>`POST /v2/signupLogin/signup/` | — | yes | — | global / otp:requires | COVERED (flow only) |
| kpost-api | `signup-login-signup-get`<br>`GET /v2/signupLogin/signup/` | yes | yes | yes | read | COVERED (contract + flow) |
| kpost-api | `signup-login-user-login`<br>`POST /v2/signupLogin/userLogin/` | yes | yes | yes | read | COVERED (contract + flow) |
| kpost-api | `signup-login-user-logout`<br>`POST /v2/signupLogin/userLogout/` | — | yes | yes | data | COVERED (flow only) |
| kpost-api | `update-user`<br>`PUT /users/{id}` | yes | — | — | mock fixture | COVERED (contract) |
