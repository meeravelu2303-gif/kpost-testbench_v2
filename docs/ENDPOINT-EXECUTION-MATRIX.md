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
| — driven by a hand-written application flow | 184 |
| — both layers | 123 |
| — flow only (no generated cases) | 61 |
| — cleared for live (`productionSafe`) | 116 |
| — a schema is held for the endpoint (contract declared) | 279 |
| — negative / input-validation probes apply | 289 |
| — auth + security probes apply | 251 |
| — named by a business invariant | 39 |
| — that invariant also declares observed states | 13 |
| — cross-checked by a UI spec | 6 |
| — observed by a cross-actor or confirmation spec | 22 |
| — documented exclusions (not applicable) | 5 |
| — blocked (coverage debt, recovery path below) | 0 |

## Reading the coverage dimensions

They answer different questions and are deliberately NOT summed into a single score — a
percentage would let a strong dimension hide a missing one, which is the exact failure this
matrix exists to prevent.

| Dimension | What a yes claims |
| --------- | ----------------- |
| Contract | a request or response SCHEMA is held for this endpoint — the contract itself, not a test |
| Generated | describeEndpointCases / describeEndpointContracts builds validator cases for it |
| Negative | the request fuzzers apply. For a GET that is query and path only: the body fuzzers are gated on carriesRequestBody, because a body sent with a GET is ignored and a 200 would be a false finding |
| Security | the auth-token and security probes apply — generated, authenticated, and not excluded by the endpoint own skipValidators |
| Flow | a hand-written application flow drives it |
| Live | default = runs on a normal live run; gated = driven live only behind its *_LIFECYCLE flag |
| State | an invariant naming this endpoint also declares the states it observes |
| Rule | some business invariant names it in appliesTo |
| UI | a UI spec drives or asserts against it |
| Confirm | a cross-actor or confirmation spec observes it independently |

**Business-rule and state coverage are read from the INVARIANT REGISTRY**, never from a test
title or a filename — otherwise the matrix would reward naming a file well rather than
declaring a rule.

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

| Endpoint | Module | Method | Path | Contract | Generated | Negative | Security | Flow | Live | State | Rule | UI | Confirm | Write class | Status | Reason |
| -------- | ------ | ------ | ---- | -------- | --------- | -------- | -------- | ---- | ---- | ----- | ---- | -- | ------- | ----------- | ------ | ------ |
| `admin-country-address-by-pincode` | country-address | GET | `/country/getAddressUsingPincodeAndCountry/{pincode}/{country}` | — | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `admin-employee-delete` | employee | POST | `/employeeDetails/delete` | yes | yes | yes | yes | yes | gated | — | — | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `admin-employee-details` | employee | POST | `/employeeDetails/getEmployeeDetails` | yes | yes | yes | yes | yes | default | — | — | — | — | read | COVERED (contract + flow) | covered at every layer that applies to it |
| `admin-employee-save` | employee | POST | `/employeeDetails/save` | yes | yes | yes | yes | yes | gated | — | yes | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `admin-employee-update` | employee | POST | `/employeeDetails/update` | yes | yes | yes | yes | yes | gated | — | — | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `admin-hr-tier-attribute-by-company` | hr-tier-attribute | POST | `/hrSetUpTierAttribute/getAttributeByCompanyId` | yes | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `admin-hr-tier-attribute-delete` | hr-tier-attribute | POST | `/hrSetUpTierAttribute/delete` | yes | yes | yes | yes | yes | gated | — | — | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `admin-hr-tier-attribute-save` | hr-tier-attribute | POST | `/hrSetUpTierAttribute/save` | yes | yes | yes | yes | yes | gated | — | yes | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `admin-hr-tier-attribute-update` | hr-tier-attribute | POST | `/hrSetUpTierAttribute/update` | yes | yes | yes | yes | yes | gated | — | — | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `admin-hr-tier-variable-delete` | hr-tier-variable | POST | `/hrSetUpTierVariable/delete` | yes | yes | yes | yes | yes | gated | — | — | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `admin-hr-tier-variable-list` | hr-tier-variable | POST | `/hrSetUpTierVariable/getHrSetUpTierVariable` | yes | yes | yes | yes | yes | default | — | — | — | — | read | COVERED (contract + flow) | covered at every layer that applies to it |
| `admin-hr-tier-variable-reporting-hierarchy` | hr-tier-variable | POST | `/hrSetUpTierVariable/getAllReportingHrTierVariableHierarchy` | yes | yes | yes | yes | yes | gated | — | — | — | — | read | COVERED (contract + flow) | covered at every layer that applies to it |
| `admin-hr-tier-variable-save` | hr-tier-variable | POST | `/hrSetUpTierVariable/save` | yes | yes | yes | yes | yes | gated | — | yes | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `admin-hr-tier-variable-update` | hr-tier-variable | POST | `/hrSetUpTierVariable/update` | yes | yes | yes | yes | yes | gated | — | — | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `admin-role-posting-by-company` | role-posting | POST | `/rolePosting/getRolePostingByCompanyId` | yes | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `admin-role-posting-by-company-and-employee` | role-posting | POST | `/rolePosting/getRolePostingByCompanyIdAndEmployeeId` | yes | yes | yes | yes | yes | gated | — | — | — | — | read | COVERED (contract + flow) | covered at every layer that applies to it |
| `admin-role-posting-delete` | role-posting | POST | `/rolePosting/delete` | yes | yes | yes | yes | — | — | — | — | — | — | data | COVERED (contract) | contract-validated off live only |
| `admin-role-posting-employees` | role-posting | POST | `/rolePosting/getEmployeeByCompanyId` | yes | yes | yes | yes | yes | default | — | — | — | — | read | COVERED (contract + flow) | covered at every layer that applies to it |
| `admin-role-posting-save` | role-posting | POST | `/rolePosting/save` | yes | yes | yes | yes | — | — | — | — | — | — | data | COVERED (contract) | contract-validated off live only |
| `admin-role-posting-suspend-terminate` | role-posting | POST | `/rolePosting/suspendOrTerminateEmployee` | yes | yes | yes | yes | — | — | — | — | — | — | data | COVERED (contract) | contract-validated off live only |
| `admin-role-posting-suspended-list` | role-posting | POST | `/rolePosting/getSuspendOrTerminateEmployee` | yes | yes | yes | yes | — | — | — | — | — | — | read | COVERED (contract) | contract-validated off live only |
| `admin-role-posting-update` | role-posting | POST | `/rolePosting/update` | yes | yes | yes | yes | — | — | — | — | — | — | data | COVERED (contract) | contract-validated off live only |
| `admin-workplace-hierarchy` | workplace-hierarchy | POST | `/workplaceHierarchy/getWorkPlaceHierarchy` | yes | yes | yes | yes | yes | gated | — | — | — | — | read | COVERED (contract + flow) | covered at every layer that applies to it |
| `admin-workplace-location-all` | workplace-location | POST | `/location/getAllLocation` | yes | yes | yes | yes | yes | default | — | — | — | — | read | COVERED (contract + flow) | covered at every layer that applies to it |
| `admin-workplace-location-by-id` | workplace-location | POST | `/location/getLocationById` | yes | yes | yes | yes | yes | gated | — | — | — | — | read | COVERED (contract + flow) | covered at every layer that applies to it |
| `admin-workplace-location-delete` | workplace-location | POST | `/location/delete` | yes | yes | yes | yes | yes | gated | — | — | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `admin-workplace-location-get` | workplace-location | POST | `/location/getLocation` | yes | yes | yes | yes | yes | gated | — | — | — | — | read | COVERED (contract + flow) | covered at every layer that applies to it |
| `admin-workplace-location-save` | workplace-location | POST | `/location/save` | yes | yes | yes | yes | yes | gated | — | yes | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `admin-workplace-location-update` | workplace-location | POST | `/location/update` | yes | yes | yes | yes | yes | gated | — | — | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `admin-workplace-tier-attribute-by-company` | workplace-tier-attribute | POST | `/adminTierAttribute/getAttributeByCompanyId` | yes | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `admin-workplace-tier-attribute-delete` | workplace-tier-attribute | POST | `/adminTierAttribute/delete` | yes | yes | yes | yes | yes | gated | — | — | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `admin-workplace-tier-attribute-save` | workplace-tier-attribute | POST | `/adminTierAttribute/save` | yes | yes | yes | yes | yes | gated | — | yes | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `admin-workplace-tier-attribute-update` | workplace-tier-attribute | POST | `/adminTierAttribute/update` | yes | yes | yes | yes | yes | gated | — | — | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `admin-workplace-tier-variable-delete` | workplace-tier-variable | POST | `/adminTierVariable/delete` | yes | yes | yes | yes | yes | gated | — | — | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `admin-workplace-tier-variable-list` | workplace-tier-variable | POST | `/adminTierVariable/getAdminTierVariable` | yes | yes | yes | yes | yes | default | — | — | — | — | read | COVERED (contract + flow) | covered at every layer that applies to it |
| `admin-workplace-tier-variable-reporting-hierarchy` | workplace-tier-variable | POST | `/adminTierVariable/getAllReportingVariableHierarchy` | yes | yes | yes | yes | yes | gated | — | — | — | — | read | COVERED (contract + flow) | covered at every layer that applies to it |
| `admin-workplace-tier-variable-save` | workplace-tier-variable | POST | `/adminTierVariable/save` | yes | yes | yes | yes | yes | gated | — | yes | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `admin-workplace-tier-variable-update` | workplace-tier-variable | POST | `/adminTierVariable/update` | yes | yes | yes | yes | yes | gated | — | — | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `kmail-add-od-contact` | kmail | POST | `/testkmail/v2/common/addOtherDomainContacts/` | yes | yes | yes | yes | — | — | — | — | — | — | data | COVERED (contract) | contract-validated off live only |
| `kmail-all-drafts` | kmail | GET | `/testkmail/v2/draft/getAllDraftMails/` | yes | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `kmail-all-letterhead` | kmail | GET | `/testkmail/v2/kmailSetting/getAllLetterHead` | — | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `kmail-all-mail-count` | kmail | POST | `/testkmail/v2/common/getAllMailCount` | yes | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `kmail-bulk-dashboard` | kmail | POST | `/testkmail/v2/common/getBulkKmailDashboardMsg` | yes | yes | yes | yes | — | — | — | — | — | — | read | COVERED (contract) | contract-validated off live only |
| `kmail-bulk-status` | kmail | GET | `/testkmail/v2/sentMail/bulkMail/status/{fromAddress}` | — | yes | yes | yes | — | — | — | — | — | — | read | COVERED (contract) | contract-validated off live only |
| `kmail-clear-all-status` | kmail | POST | `/testkmail/v2/common/clearStatusOfAllKmailsContacts` | — | yes | yes | yes | — | — | — | — | — | — | data | COVERED (contract) | contract-validated off live only |
| `kmail-clear-status` | kmail | POST | `/testkmail/v2/common/clearStatusOfKmailsContacts/` | — | yes | yes | yes | — | — | — | — | — | — | data | COVERED (contract) | contract-validated off live only |
| `kmail-convert-pdf` | kmail | POST | `/testkmail/v2/common/convertMailAsPDF/` | — | yes | yes | yes | — | — | — | — | — | — | data | COVERED (contract) | contract-validated off live only |
| `kmail-copies-info` | kmail | GET | `/testkmail/v2/readMail/getCopiesInfo/{kmailID}` | — | yes | yes | yes | — | — | — | — | — | — | read | COVERED (contract) | contract-validated off live only |
| `kmail-count-days-limit` | kmail | GET | `/testkmail/v2/kmailSetting/getMailCountDaysLimit` | — | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `kmail-count-days-limit-update` | kmail | POST | `/testkmail/v2/kmailSetting/updateMailCountDaysLimit` | yes | yes | yes | yes | yes | gated | — | — | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `kmail-credentials` | kmail | POST | `/testkmail/v2/sentMail/getMailCredentials/` | yes | yes | yes | yes | — | — | — | — | — | — | global | COVERED (contract) | contract-validated off live only |
| `kmail-dashboard` | kmail | POST | `/testkmail/v2/common/getKmailDashboardMsg/` | yes | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `kmail-delete` | kmail | POST | `/testkmail/v2/common/deleteKmailWithDeletedBy/` | yes | yes | yes | yes | yes | gated | — | — | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `kmail-delete-instant-reply` | kmail | POST | `/testkmail/v2/kmailSetting/deleteCustomizedInstantReply` | yes | yes | yes | yes | — | — | — | — | — | — | data | COVERED (contract) | contract-validated off live only |
| `kmail-delete-letterhead` | kmail | POST | `/testkmail/v2/kmailSetting/deleteLetterHead` | yes | yes | yes | yes | — | — | — | — | — | — | data | COVERED (contract) | contract-validated off live only |
| `kmail-delete-od-contact` | kmail | POST | `/testkmail/v2/common/deleteOtherDomainContact/` | yes | yes | yes | yes | — | — | — | — | — | — | data | COVERED (contract) | contract-validated off live only |
| `kmail-delete-saluation` | kmail | POST | `/testkmail/v2/kmailSetting/deleteCustomizedSaluation` | yes | yes | yes | yes | — | — | — | — | — | — | data | COVERED (contract) | contract-validated off live only |
| `kmail-details-by-id` | kmail | POST | `/testkmail/v2/readMail/getKmailDetailsUsingKmailID` | yes | yes | yes | yes | yes | gated | — | — | — | — | read | COVERED (contract + flow) | covered at every layer that applies to it |
| `kmail-digital-signature` | kmail | GET | `/testkmail/v2/kmailSetting/getDigitalSignature` | — | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `kmail-download-attachment` | kmail | GET | `/testkmail/v2/readMail/download/{uuid}` | — | yes | yes | yes | — | — | — | — | — | — | read | COVERED (contract) | contract-validated off live only |
| `kmail-download-od-attachment` | kmail | POST | `/testkmail/v2/readMail/downloadODAttachment` | yes | yes | yes | yes | — | — | — | — | — | — | data | COVERED (contract) | contract-validated off live only |
| `kmail-download-thumbnail` | kmail | GET | `/testkmail/v2/readMail/downloadThumbnail/{uuid}` | — | yes | yes | yes | — | — | — | — | — | — | read | COVERED (contract) | contract-validated off live only |
| `kmail-draft-contacts` | kmail | GET | `/testkmail/v2/draft/getDraftMailsContacts/` | yes | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `kmail-draft-content` | kmail | POST | `/testkmail/v2/readMail/draftMailContent` | yes | yes | yes | yes | — | — | — | — | — | — | read | COVERED (contract) | contract-validated off live only |
| `kmail-draft-delete` | kmail | POST | `/testkmail/v2/draft/deleteDraftMail/` | yes | yes | yes | yes | yes | gated | — | — | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `kmail-draft-multipart` | kmail | POST | `/testkmail/v2/draft/draftMailMultiPart` | — | yes | yes | yes | — | — | — | — | — | — | data | COVERED (contract) | contract-validated off live only |
| `kmail-draft-save` | kmail | POST | `/testkmail/v2/draft/draftMail/` | yes | yes | yes | yes | yes | gated | — | — | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `kmail-drafts-for-contact` | kmail | POST | `/testkmail/v2/draft/getDraftMailsForSelectedContact/` | yes | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `kmail-edit-od-contact` | kmail | POST | `/testkmail/v2/common/editOtherDomainContactsDetails/` | yes | yes | yes | yes | — | — | — | — | — | — | data | COVERED (contract) | contract-validated off live only |
| `kmail-frequent-contact` | kmail | GET | `/testkmail/v2/common/frequentKmailContact/` | yes | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `kmail-group-read-status` | kmail | POST | `/testkmail/v2/common/kmailGroupReadStatus/` | yes | yes | yes | yes | yes | gated | yes | yes | — | — | read | COVERED (contract + flow) | covered at every layer that applies to it |
| `kmail-important-mails` | kmail | POST | `/testkmail/v2/common/getAllImportantMails/` | yes | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `kmail-instant-reply` | kmail | GET | `/testkmail/v2/common/getInstantReply/` | yes | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `kmail-known-postbox-contacts` | kmail | POST | `/testkmail/v2/common/knownPostBoxContacts/` | yes | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `kmail-letterhead` | kmail | GET | `/testkmail/v2/kmailSetting/getLetterHead` | — | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `kmail-letterhead-template` | kmail | GET | `/testkmail/v2/kmailSetting/getLetterHeadTemplate` | — | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `kmail-mail-content` | kmail | POST | `/testkmail/v2/readMail/sentAndInboxMailContent/` | yes | yes | yes | yes | yes | gated | yes | yes | — | — | read | COVERED (contract + flow) | covered at every layer that applies to it |
| `kmail-mail-signature` | kmail | GET | `/testkmail/v2/kmailSetting/getMailSignature` | — | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `kmail-media-streaming` | kmail | GET | `/testkmail/v2/readMail/mediaStreaming/{uuid}` | — | yes | yes | yes | — | — | — | — | — | — | read | COVERED (contract) | contract-validated off live only |
| `kmail-misc-contacts` | kmail | GET | `/testkmail/v2/common/miscellaneousContacts/` | yes | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `kmail-other-domain-mails` | kmail | GET | `/testkmail/v2/sentMail/loadOtherDomainMails/` | yes | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `kmail-post-bulk` | kmail | POST | `/testkmail/v2/sentMail/postBulkMail` | yes | yes | yes | yes | — | — | — | — | — | — | data | COVERED (contract) | contract-validated off live only |
| `kmail-post-mail` | kmail | POST | `/testkmail/v2/sentMail/postMail/` | yes | yes | yes | yes | yes | gated | — | yes | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `kmail-postbox-contacts` | kmail | POST | `/testkmail/v2/common/postBoxContacts/` | yes | yes | yes | yes | — | — | — | — | — | — | read | COVERED (contract) | contract-validated off live only |
| `kmail-reference-content` | kmail | POST | `/testkmail/v2/readMail/referenceMailContent/` | yes | yes | yes | yes | — | — | — | — | — | — | read | COVERED (contract) | contract-validated off live only |
| `kmail-reply-not-received` | kmail | POST | `/testkmail/v2/common/replyNotReceived/` | yes | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `kmail-reply-not-req-receiver` | kmail | POST | `/testkmail/v2/common/replyNotRequiredByReceiver/` | yes | yes | yes | yes | yes | gated | — | — | — | — | read | COVERED (contract + flow) | covered at every layer that applies to it |
| `kmail-reply-not-req-sender` | kmail | POST | `/testkmail/v2/common/replyNotRequiredBySender/` | yes | yes | yes | yes | yes | gated | — | — | — | — | read | COVERED (contract + flow) | covered at every layer that applies to it |
| `kmail-reply-not-sent` | kmail | POST | `/testkmail/v2/common/replyNotSent/` | yes | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `kmail-saluations` | kmail | GET | `/testkmail/v2/common/getSaluations/` | yes | yes | yes | yes | — | default | — | yes | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `kmail-save-saluation` | kmail | POST | `/testkmail/v2/kmailSetting/saveOrUpdateCustomizedSaluations` | yes | yes | yes | yes | yes | gated | — | — | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `kmail-selected-contact-mails` | kmail | POST | `/testkmail/v2/common/selectedContactMails/` | — | yes | yes | yes | yes | default | — | — | — | — | read | COVERED (contract + flow) | covered at every layer that applies to it |
| `kmail-sent-not-opened` | kmail | POST | `/testkmail/v2/common/sentMailNotOpened/` | yes | yes | yes | yes | yes | default | yes | yes | — | — | read | COVERED (contract + flow) | covered at every layer that applies to it |
| `kmail-set-important` | kmail | POST | `/testkmail/v2/common/setKmailAsImportant/` | yes | yes | yes | yes | yes | gated | — | — | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `kmail-set-instant-reply` | kmail | POST | `/testkmail/v2/kmailSetting/saveOrUpdateCustomizedInstantReply` | yes | yes | yes | yes | yes | gated | — | — | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `kmail-set-letterhead` | kmail | POST | `/testkmail/v2/kmailSetting/setLetterHead` | yes | yes | yes | yes | — | — | — | — | — | — | data | COVERED (contract) | contract-validated off live only |
| `kmail-sig-company` | kmail | POST | `/testkmail/v2/kmailSetting/saveOrUpdateMailSignatureCompanyData` | yes | yes | yes | yes | — | — | — | — | — | — | data | COVERED (contract) | contract-validated off live only |
| `kmail-sig-full` | kmail | POST | `/testkmail/v2/kmailSetting/saveOrUpdateMailSignature` | yes | yes | yes | yes | — | — | — | — | — | — | data | COVERED (contract) | contract-validated off live only |
| `kmail-sig-graphics` | kmail | POST | `/testkmail/v2/kmailSetting/saveOrUpdateMailSignatureGraphics` | yes | yes | yes | yes | — | — | — | — | — | — | data | COVERED (contract) | contract-validated off live only |
| `kmail-sig-personal` | kmail | POST | `/testkmail/v2/kmailSetting/saveOrUpdateMailSignaturePersonalData` | yes | yes | yes | yes | yes | gated | — | — | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `kmail-sig-social` | kmail | POST | `/testkmail/v2/kmailSetting/saveOrUpdateMailSignatureSocialMediaLink` | yes | yes | yes | yes | — | — | — | — | — | — | data | COVERED (contract) | contract-validated off live only |
| `kmail-sig-style` | kmail | POST | `/testkmail/v2/kmailSetting/saveOrUpdateMailSignatureStyle` | yes | yes | yes | yes | — | — | — | — | — | — | data | COVERED (contract) | contract-validated off live only |
| `kmail-sig-template` | kmail | POST | `/testkmail/v2/kmailSetting/saveOrUpdateMailSignatureTemplateId` | yes | yes | yes | yes | — | — | — | — | — | — | data | COVERED (contract) | contract-validated off live only |
| `kmail-status-total-count` | kmail | GET | `/testkmail/v2/common/statusOfKmailsContactsTotalCount/` | — | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `kmail-status-with-count` | kmail | POST | `/testkmail/v2/common/statusOfKmailsContactsWithCount/` | yes | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `kmail-subjects` | kmail | POST | `/testkmail/v2/common/mailSubjectSelectedContact/` | yes | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `kmail-translation` | kmail | POST | `/testkmail/v2/translator/translation/` | yes | yes | yes | — | — | default | — | — | — | — | read | COVERED (contract) | security probes excluded (skipValidators, or the endpoint is unauthenticated) |
| `kmail-unopened-count` | kmail | GET | `/testkmail/v2/common/unOpenedMailCountBySenderID/` | yes | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `admin-adding-user-by-admin` | company | POST | `/admin/addingUserByAdmin/` | yes | yes | yes | yes | — | — | — | — | — | — | global | COVERED (contract) | contract-validated off live only |
| `admin-bank-and-company-details` | company | GET | `/admin/getBankAndCompanyDetails/{companyID}` | — | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `admin-create-remove-backup-admin` | company | POST | `/admin/createOrRemoveBackupAdmin/` | yes | yes | yes | yes | — | — | — | — | — | — | global | COVERED (contract) | contract-validated off live only |
| `admin-display-name-suggestion` | company | POST | `/admin/displayNameSuggestion` | yes | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `admin-hold-or-release` | company | POST | `/admin/holdOrRelease/` | yes | yes | yes | yes | — | — | — | — | — | — | global | COVERED (contract) | contract-validated off live only |
| `admin-kpostid-designation-suggestion` | company | POST | `/v2/admin/createKpostIDAndDesignationSuggestion` | yes | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `admin-reset-password` | company | POST | `/admin/resetPassword/` | yes | yes | yes | yes | — | — | — | — | — | — | global | COVERED (contract) | contract-validated off live only |
| `admin-terminate-user` | company | POST | `/admin/terminateUser/` | yes | yes | yes | yes | — | — | — | — | — | — | global | COVERED (contract) | contract-validated off live only |
| `admin-update-bank-account` | company | POST | `/v2/admin/updateBankAccountDetails` | yes | yes | yes | yes | — | — | — | — | — | — | global | COVERED (contract) | contract-validated off live only |
| `admin-update-company-details` | company | POST | `/v2/admin/updateCompanyDetails` | yes | yes | yes | yes | — | — | — | — | — | — | global | COVERED (contract) | contract-validated off live only |
| `admin-update-role` | company | POST | `/v2/admin/updateRole` | yes | yes | yes | yes | — | — | — | — | — | — | global | COVERED (contract) | contract-validated off live only |
| `admin-user-management-details` | company | GET | `/admin/userManagementDetails/{companyID}` | yes | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `auth-login` | critical | POST | `/auth/login` | yes | yes | yes | — | — | — | — | — | — | — | mock fixture | COVERED (contract) | security probes excluded (skipValidators, or the endpoint is unauthenticated) |
| `aws-check-attachment` | aws | POST | `/v2/aws/checkAttachmentS3/` | yes | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `aws-delete-attachment` | aws | GET | `/v2/aws/deleteAttachmentFromS3/{uuid}` | — | yes | yes | yes | yes | gated | — | — | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `aws-generate-presigned` | aws | POST | `/v2/aws/generate-presigned-url` | yes | yes | yes | yes | yes | default | — | — | — | — | read | COVERED (contract + flow) | covered at every layer that applies to it |
| `aws-katchup-presigned` | aws | POST | `/v2/aws/katchup/generate-presigned-url` | yes | yes | yes | yes | yes | default | — | — | — | yes | read | COVERED (contract + flow) | covered at every layer that applies to it |
| `common-cities-by-region` | common | POST | `/v2/common/getCitiesByRegionId/` | yes | yes | yes | — | — | default | — | — | — | — | read | COVERED (contract) | security probes excluded (skipValidators, or the endpoint is unauthenticated) |
| `common-company-details` | common | POST | `/v2/common/getCompanyDetails` | yes | yes | yes | — | — | default | — | — | — | — | read | COVERED (contract) | security probes excluded (skipValidators, or the endpoint is unauthenticated) |
| `common-company-details-by-admin` | common | POST | `/v2/common/getCompanyDetailsByAdmin` | yes | yes | yes | — | — | default | — | — | — | — | read | COVERED (contract) | security probes excluded (skipValidators, or the endpoint is unauthenticated) |
| `common-company-details-by-mobile-and-product` | common | POST | `/v2/common/getCompanyDetailsByMobileNoAndproductId` | yes | yes | yes | — | — | default | — | — | — | — | read | COVERED (contract) | security probes excluded (skipValidators, or the endpoint is unauthenticated) |
| `common-company-name-exist` | common | GET | `/v2/common/getCompanyNameExistOnKpostAndKsmacc/{companyName}` | — | yes | yes | — | — | default | — | — | — | — | read | COVERED (contract) | security probes excluded (skipValidators, or the endpoint is unauthenticated) |
| `common-countries` | common | GET | `/v2/common/countries` | yes | yes | yes | — | — | default | — | — | — | — | read | COVERED (contract) | security probes excluded (skipValidators, or the endpoint is unauthenticated) |
| `common-designation` | common | POST | `/v2/common/getDesignation/` | yes | yes | yes | — | — | default | — | — | — | — | read | COVERED (contract) | security probes excluded (skipValidators, or the endpoint is unauthenticated) |
| `common-domain` | common | POST | `/v2/common/domain/` | yes | yes | yes | — | — | default | — | — | — | — | read | COVERED (contract) | security probes excluded (skipValidators, or the endpoint is unauthenticated) |
| `common-download-company-logo` | common | GET | `/v2/common/downloadCompanyLogo/{companyID}` | — | yes | yes | yes | yes | gated | — | — | — | — | read | COVERED (contract + flow) | covered at every layer that applies to it |
| `common-flutter-app-version` | common | GET | `/v2/common/getFlutterAppVersion/` | — | yes | yes | — | — | default | — | — | — | — | read | COVERED (contract) | security probes excluded (skipValidators, or the endpoint is unauthenticated) |
| `common-forgot-password-otp` | common | POST | `/v2/common/forgotPasswordOTPOrSentKpostIDSms` | yes | yes | yes | — | yes | gated | — | — | — | — | external / otp:sends | COVERED (contract + flow) | security probes excluded (skipValidators, or the endpoint is unauthenticated) |
| `common-forgot-password-update` | common | POST | `/v2/common/forgotPasswordUpdate` | yes | yes | yes | — | yes | gated | — | — | — | — | global / otp:requires | COVERED (contract + flow) | security probes excluded (skipValidators, or the endpoint is unauthenticated) |
| `common-generate-domain-and-unique-name` | common | POST | `/v2/common/generateDomainAndUniqueName` | yes | yes | yes | — | — | default | — | — | — | — | read | COVERED (contract) | security probes excluded (skipValidators, or the endpoint is unauthenticated) |
| `common-kpost-id-using-module` | common | POST | `/v2/common/getKpostIdUsingModule` | yes | yes | yes | — | — | default | — | — | — | — | read | COVERED (contract) | security probes excluded (skipValidators, or the endpoint is unauthenticated) |
| `common-languages` | common | POST | `/v2/common/languages` | yes | yes | yes | — | — | default | — | — | — | — | read | COVERED (contract) | security probes excluded (skipValidators, or the endpoint is unauthenticated) |
| `common-mobile-no-exist` | common | POST | `/v2/common/mobileNoExist/` | yes | yes | yes | — | — | default | — | — | — | — | read | COVERED (contract) | security probes excluded (skipValidators, or the endpoint is unauthenticated) |
| `common-mobile-no-exist-in-company` | common | POST | `/v2/common/mobileNoExistInsideCompany/` | yes | yes | yes | — | — | default | — | — | — | — | read | COVERED (contract) | security probes excluded (skipValidators, or the endpoint is unauthenticated) |
| `common-ms-status` | common | GET | `/v2/common/msStatus/` | yes | yes | yes | — | — | default | — | — | — | — | read | COVERED (contract) | security probes excluded (skipValidators, or the endpoint is unauthenticated) |
| `common-pincode` | common | POST | `/v2/common/pinCode` | yes | yes | yes | — | — | default | — | — | — | — | read | COVERED (contract) | security probes excluded (skipValidators, or the endpoint is unauthenticated) |
| `common-postal-pincode` | common | POST | `/v2/common/postalPinCode/` | yes | yes | yes | — | — | default | — | — | — | — | read | COVERED (contract) | security probes excluded (skipValidators, or the endpoint is unauthenticated) |
| `common-remove-company-logo` | common | POST | `/admin/removeCompanyLogo` | yes | yes | yes | yes | yes | gated | — | — | — | — | global | COVERED (contract + flow) | covered at every layer that applies to it |
| `common-save-enquiry-details` | common | POST | `/v2/common/saveEnquiryDetails` | yes | yes | yes | — | yes | gated | — | — | — | — | data | COVERED (contract + flow) | security probes excluded (skipValidators, or the endpoint is unauthenticated) |
| `common-save-unsubscriber-details` | common | POST | `/v2/common/saveUnsubscriberDetails` | yes | yes | yes | — | yes | gated | — | — | — | — | data | COVERED (contract + flow) | security probes excluded (skipValidators, or the endpoint is unauthenticated) |
| `common-send-otp` | common | POST | `/v2/common/sendOTP/` | yes | yes | yes | — | yes | gated | — | — | — | — | external / otp:sends | COVERED (contract + flow) | security probes excluded (skipValidators, or the endpoint is unauthenticated) |
| `common-send-otp-to-mail` | common | POST | `/v2/common/sendOTPtoMail/` | yes | yes | yes | — | yes | gated | — | — | — | — | external / otp:sends | COVERED (contract + flow) | security probes excluded (skipValidators, or the endpoint is unauthenticated) |
| `common-states` | common | GET | `/v2/common/getStates/` | — | yes | yes | — | — | default | — | — | — | — | read | COVERED (contract) | security probes excluded (skipValidators, or the endpoint is unauthenticated) |
| `common-total-count-by-date` | common | POST | `/v2/common/getTotalCountByDate` | yes | yes | yes | — | yes | default | — | — | — | yes | read | COVERED (contract + flow) | security probes excluded (skipValidators, or the endpoint is unauthenticated) |
| `common-unique-name-exist` | common | POST | `/v2/common/uniqueNameExist` | yes | yes | yes | — | — | default | — | — | — | — | read | COVERED (contract) | security probes excluded (skipValidators, or the endpoint is unauthenticated) |
| `common-update-company-logo` | common | POST | `/v2/common/updateCompanyLogo` | yes | yes | yes | yes | yes | gated | — | — | — | — | global | COVERED (contract + flow) | covered at every layer that applies to it |
| `common-update-flutter-app-version` | common | POST | `/v2/common/updateFlutterAppVersion` | yes | yes | yes | — | yes | gated | — | — | — | — | global | COVERED (contract + flow) | security probes excluded (skipValidators, or the endpoint is unauthenticated) |
| `common-user-details-by-mobile` | common | POST | `/v2/common/getUserDetailsByMobNo` | yes | yes | yes | — | — | default | — | — | — | — | read | COVERED (contract) | security probes excluded (skipValidators, or the endpoint is unauthenticated) |
| `common-validate-mail-otp` | common | POST | `/v2/common/validateMailOTP/` | yes | — | — | — | yes | gated | — | — | — | — | read | COVERED (flow only) | documented exclusion — see above |
| `common-validate-otp` | common | POST | `/v2/common/validateOTP/` | yes | — | — | — | yes | gated | — | — | — | — | read | COVERED (flow only) | documented exclusion — see above |
| `contacts-add` | contacts | POST | `/v2/contacts/addContact` | yes | — | — | — | yes | gated | — | — | — | — | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `contacts-add-multiple` | contacts | POST | `/v2/contacts/addMultipleContact` | yes | — | — | — | yes | gated | — | — | — | — | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `contacts-add-reference` | contacts | POST | `/v2/contacts/addContactReference/` | yes | — | — | — | yes | gated | — | — | — | — | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `contacts-block` | contacts | POST | `/v2/contacts/blockOrUnBlockContact/` | — | — | — | — | yes | gated | — | — | — | — | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `contacts-block-multiple` | contacts | POST | `/v2/contacts/blockOrUnBlockMultipleContact` | yes | — | — | — | yes | gated | — | — | — | — | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `contacts-blocked` | contacts | GET | `/v2/contacts/getblockContactDetails` | — | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `contacts-delete` | contacts | POST | `/v2/contacts/deleteContact/` | yes | — | — | — | yes | gated | — | — | — | — | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `contacts-global-search` | contacts | POST | `/v2/contacts/globalSearch/` | yes | yes | yes | yes | yes | default | — | yes | — | yes | read | COVERED (contract + flow) | covered at every layer that applies to it |
| `contacts-import-phone` | contacts | POST | `/v2/contacts/importPhoneContacts/` | yes | — | — | — | yes | gated | — | — | — | — | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `contacts-imported-phone` | contacts | GET | `/v2/contacts/getImportedPhoneContacts/` | yes | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `contacts-my-contacts` | contacts | POST | `/v2/contacts/myContacts/` | yes | yes | yes | yes | yes | default | — | yes | — | — | read | COVERED (contract + flow) | covered at every layer that applies to it |
| `contacts-my-groups` | contacts | POST | `/v2/contacts/myGroups/` | yes | yes | yes | yes | yes | default | — | yes | yes | yes | read | COVERED (contract + flow) | covered at every layer that applies to it |
| `contacts-my-unknown-contacts` | contacts | POST | `/v2/contacts/myUnknownKatchupContacts/` | yes | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `contacts-my-unknown-groups` | contacts | POST | `/v2/contacts/myUnknownGroups/` | yes | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `contacts-search-details` | contacts | POST | `/v2/contacts/getSearchDetails/` | yes | yes | yes | yes | yes | default | — | — | — | yes | read | COVERED (contract + flow) | covered at every layer that applies to it |
| `contacts-update-invite` | contacts | POST | `/v2/contacts/updateInviteStatus/` | yes | — | — | — | yes | gated | — | — | — | — | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `create-company` | critical | POST | `/companies` | yes | yes | yes | yes | yes | gated | — | — | — | — | mock fixture | COVERED (contract + flow) | covered at every layer that applies to it |
| `create-user` | critical | POST | `/users` | yes | yes | yes | yes | yes | gated | — | — | — | — | mock fixture | COVERED (contract + flow) | covered at every layer that applies to it |
| `dashboard-home-msgs` | dashboard | POST | `/v2/dashboard/homeDashboardMsgs/` | yes | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `dashboard-home-new-msgs` | dashboard | POST | `/v2/dashboard/homeDashboardNewMsgs` | yes | yes | yes | yes | yes | gated | — | — | — | — | read | COVERED (contract + flow) | covered at every layer that applies to it |
| `dashboard-katchup-msg` | dashboard | POST | `/v2/dashboard/katchupDashboardMsg/` | yes | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `delete-user` | users | DELETE | `/users/{id}` | — | yes | yes | yes | yes | gated | — | — | — | — | mock fixture | COVERED (contract + flow) | covered at every layer that applies to it |
| `get-user` | critical | GET | `/users/{id}` | yes | yes | yes | yes | yes | gated | — | — | — | — | mock fixture | COVERED (contract + flow) | covered at every layer that applies to it |
| `group-add-user` | group | POST | `/v2/group/addUserToGroup/` | yes | — | — | — | yes | gated | — | yes | — | — | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `group-admin-access` | group | POST | `/v2/group/addOrRemoveAdminAccess/` | yes | — | — | — | yes | gated | — | yes | — | yes | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `group-create` | group | POST | `/v2/group/createUserGroup/` | yes | — | — | — | yes | gated | — | yes | — | yes | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `group-delete` | group | POST | `/v2/group/deleteGroup` | yes | — | — | — | yes | gated | — | yes | yes | yes | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `group-download-full-image` | group | GET | `/v2/group/downloadGroupFullProfileImage/{groupKpostID}/{kpostID}` | — | — | — | — | yes | gated | — | — | — | — | read | COVERED (flow only) | driven by a flow; no generated validator cases |
| `group-download-image` | group | GET | `/v2/group/downloadGroupProfileImage/{groupKpostID}/{kpostID}` | — | — | — | — | yes | gated | — | — | — | — | read | COVERED (flow only) | driven by a flow; no generated validator cases |
| `group-edit-name` | group | POST | `/v2/group/editGroupName` | yes | — | — | — | yes | gated | — | — | — | — | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `group-leave` | group | POST | `/v2/group/leaveFromGroup/` | yes | — | — | — | yes | gated | — | yes | — | — | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `group-remove-image` | group | POST | `/v2/group/removeGroupProfileImage` | yes | — | — | — | yes | gated | — | — | — | — | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `group-remove-member` | group | POST | `/v2/group/removeGroupMember/` | yes | — | — | — | yes | gated | — | yes | yes | yes | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `group-update-image` | group | POST | `/v2/group/updateGroupProfileImage/` | yes | — | — | — | yes | gated | — | — | — | — | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `health-check` | critical | GET | `/health` | yes | yes | yes | yes | — | — | — | — | — | — | mock fixture | COVERED (contract) | contract-validated off live only |
| `kall-clear-by-ids` | kall | POST | `/v2/kall/clearKallBykallIds` | yes | — | — | — | yes | gated | — | — | — | — | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `kall-clear-history` | kall | GET | `/v2/kall/clearKallHistory` | yes | — | — | — | yes | gated | — | — | — | yes | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `kall-contact-info` | kall | POST | `/v2/kall/contactInfo/` | yes | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `kall-dashboard` | kall | POST | `/v2/kall/kallDashboard` | yes | yes | yes | yes | — | default | yes | yes | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `kall-end-individual` | kall | POST | `/v2/kall/endIndividualKall/` | yes | — | — | — | yes | gated | — | — | — | — | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `kall-end-kool` | kall | POST | `/v2/kall/endKoolKall` | yes | — | — | — | yes | gated | — | — | — | — | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `kall-fetch-scheduled-repeat` | kall | POST | `/v2/kall/fetchScheduledRepeatKall` | yes | yes | yes | yes | yes | default | — | — | — | yes | read | COVERED (contract + flow) | covered at every layer that applies to it |
| `kall-frequent-contacts` | kall | GET | `/v2/kall/frequentKallContacts` | yes | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `kall-get-status` | kall | POST | `/v2/kall/getKallStatus` | yes | yes | yes | yes | yes | gated | — | — | — | — | read | COVERED (contract + flow) | covered at every layer that applies to it |
| `kall-get-status-by-id` | kall | POST | `/v2/kall/getKallStatusUsingKallID` | yes | yes | yes | yes | yes | gated | — | — | — | — | read | COVERED (contract + flow) | covered at every layer that applies to it |
| `kall-info` | kall | POST | `/v2/kall/kallInfo` | yes | yes | yes | yes | — | default | yes | yes | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `kall-initiate` | kall | POST | `/v2/kall/initiateKall` | yes | — | — | — | yes | gated | — | — | — | — | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `kall-join-schedule` | kall | POST | `/v2/kall/joinScheduleKall` | yes | — | — | — | yes | gated | — | — | — | — | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `kall-modify-members` | kall | POST | `/v2/kall/modifyKallMembers` | yes | — | — | — | yes | gated | yes | yes | — | — | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `kall-reschedule` | kall | POST | `/v2/kall/reScheduleKall` | yes | — | — | — | yes | gated | yes | yes | — | — | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `kall-scheduled` | kall | POST | `/v2/kall/scheduledKall` | yes | — | — | — | yes | gated | — | yes | — | yes | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `kall-scheduled-repeat` | kall | POST | `/v2/kall/scheduledRepeatKall` | — | — | — | — | yes | gated | — | — | — | — | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `kall-today-kool` | kall | GET | `/v2/kall/todayKoolKall/` | yes | yes | yes | yes | yes | default | yes | yes | — | yes | read | COVERED (contract + flow) | covered at every layer that applies to it |
| `kall-update-sender-receiver-status` | kall | POST | `/v2/kall/updateSenderAndReceiverKallStatus` | yes | — | — | — | yes | gated | — | — | — | — | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `kall-update-status` | kall | POST | `/v2/kall/updateKallStatus` | yes | — | — | — | yes | gated | — | — | — | — | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `katchup-all-report-msg` | katchup | GET | `/v2/katchup/getAllReportMsg` | — | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `katchup-bulk-message-info` | katchup | POST | `/v2/katchup/getBulkMessageInfo/` | yes | yes | yes | yes | — | — | — | — | — | — | read | COVERED (contract) | contract-validated off live only |
| `katchup-conversation` | katchup | POST | `/v2/katchup/katchupMessagesForSelectedContactID/` | yes | yes | yes | yes | yes | default | yes | yes | yes | yes | read | COVERED (contract + flow) | covered at every layer that applies to it |
| `katchup-delete-message` | katchup | POST | `/v2/katchup/deleteKatchUpMessage/` | yes | yes | yes | yes | yes | gated | yes | yes | yes | yes | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `katchup-download` | katchup | GET | `/v2/katchup/download/{uuid}` | — | yes | yes | yes | — | — | — | — | — | — | read | COVERED (contract) | contract-validated off live only |
| `katchup-download-attachment` | katchup | GET | `/v2/katchup/downloadAttachment/{uuid}` | — | yes | yes | yes | — | — | — | — | — | — | read | COVERED (contract) | contract-validated off live only |
| `katchup-download-from-s3` | katchup | GET | `/v2/katchup/downloadFromS3/{uuid}` | — | yes | yes | yes | — | — | — | — | — | — | read | COVERED (contract) | contract-validated off live only |
| `katchup-download-thumbnail` | katchup | GET | `/v2/katchup/downloadThumbnail/{uuid}` | — | yes | yes | yes | — | — | — | — | — | — | read | COVERED (contract) | contract-validated off live only |
| `katchup-filter-message` | katchup | POST | `/v2/katchup/filterKatchUpMessage/` | yes | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `katchup-forward-backtrack` | katchup | POST | `/v2/katchup/forwardMessageBacktrackByMsgID` | yes | yes | yes | yes | — | — | — | — | — | — | read | COVERED (contract) | contract-validated off live only |
| `katchup-forward-message` | katchup | POST | `/v2/katchup/forwardKatchupMessage/` | yes | yes | yes | yes | yes | gated | — | yes | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `katchup-forward-message-new` | katchup | POST | `/v2/katchup/forwardKatchupMessageNew` | yes | yes | yes | yes | yes | gated | — | yes | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `katchup-forward-multiple` | katchup | POST | `/v2/katchup/forwardKatchupMultipleMsgs` | yes | yes | yes | yes | yes | gated | — | — | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `katchup-frequent-contacts` | katchup | GET | `/v2/katchup/frequentlyAccessContacts` | yes | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `katchup-generate-thumbnail` | katchup | POST | `/v2/katchup/generateThumbnailUsingUUID` | yes | yes | yes | yes | — | — | — | — | — | — | data | COVERED (contract) | contract-validated off live only |
| `katchup-mark-important` | katchup | POST | `/v2/katchup/markOrUnmarkImportantMessage/` | yes | yes | yes | yes | yes | gated | — | — | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `katchup-media-streaming` | katchup | GET | `/v2/katchup/mediaStreaming/{uuid}` | — | yes | yes | yes | — | — | — | — | — | — | read | COVERED (contract) | contract-validated off live only |
| `katchup-message-count` | katchup | POST | `/v2/katchup/messageCountBetweenSenderAndReceiver/` | yes | yes | yes | yes | yes | default | — | — | — | yes | read | COVERED (contract + flow) | covered at every layer that applies to it |
| `katchup-messages-by-reference` | katchup | POST | `/v2/katchup/getMessagesByReferenceMessageList` | yes | yes | yes | yes | — | — | — | — | — | — | read | COVERED (contract) | contract-validated off live only |
| `katchup-messages-subject` | katchup | GET | `/v2/katchup/getKatchupMessagesSubject` | — | yes | yes | yes | — | — | — | — | — | — | read | COVERED (contract) | contract-validated off live only |
| `katchup-read-status-group` | katchup | POST | `/v2/katchup/getReadStatusGroupMessage/` | yes | yes | yes | yes | yes | gated | yes | yes | — | — | read | COVERED (contract + flow) | covered at every layer that applies to it |
| `katchup-recall-message` | katchup | POST | `/v2/katchup/recallMessage/` | yes | yes | yes | yes | yes | gated | yes | yes | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `katchup-reference-details` | katchup | POST | `/v2/katchup/getReferenceMSGDetails/` | yes | yes | yes | yes | — | — | — | — | — | — | read | COVERED (contract) | contract-validated off live only |
| `katchup-report-abuse` | katchup | POST | `/v2/katchup/reportAbuse` | yes | yes | yes | yes | yes | gated | — | — | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `katchup-save-messages` | katchup | POST | `/v2/katchup/saveKatchupMessages/` | yes | yes | yes | yes | yes | gated | — | — | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `katchup-search-message` | katchup | POST | `/v2/katchup/searchKatchUpMessage/` | yes | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `katchup-search-subject` | katchup | POST | `/v2/katchup/searchKatchUpMessageSubject` | yes | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `katchup-send-bulk` | katchup | POST | `/v2/katchup/sendBulkKatchupMsg` | yes | yes | yes | yes | yes | gated | — | — | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `katchup-send-bulk-multipart` | katchup | POST | `/v2/katchup/sendBulkKatchupMsgMultiPart/` | yes | yes | yes | yes | yes | gated | — | — | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `katchup-send-forward-selected-attachment` | katchup | POST | `/v2/katchup/sendMessageForForwardSelectedAttachment` | yes | yes | yes | yes | yes | gated | — | — | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `katchup-send-message` | katchup | POST | `/v2/katchup/sendMessage/` | yes | yes | yes | yes | yes | gated | yes | yes | yes | yes | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `katchup-send-multipart` | katchup | POST | `/v2/katchup/sendKatchupMsgMultiPart/` | yes | yes | yes | yes | yes | gated | — | — | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `katchup-shared-message-details` | katchup | GET | `/v2/katchup/getSharedMessageDetails/{msgID}` | — | yes | yes | yes | — | — | — | — | — | — | read | COVERED (contract) | contract-validated off live only |
| `katchup-shared-message-info` | katchup | POST | `/v2/katchup/getSharedMessageInfo/` | yes | yes | yes | yes | — | — | — | — | — | — | read | COVERED (contract) | contract-validated off live only |
| `katchup-unopened-count` | katchup | GET | `/v2/katchup/getUnopenedMessagesCount/` | yes | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `katchup-unopened-total-count` | katchup | GET | `/v2/katchup/getUnopenedMessagesAndKmailsTotalCount/` | — | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `kdiary-add-participants` | kdiary | POST | `/dairySchedule/addparticipants` | yes | — | — | — | yes | gated | — | — | — | — | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `kdiary-create-event` | kdiary | POST | `/dairySchedule/createEvent` | — | — | — | — | yes | gated | — | — | — | — | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `kdiary-create-schedule` | kdiary | POST | `/dairySchedule/createSchedule` | yes | — | — | — | yes | gated | — | — | — | — | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `kdiary-delete-event` | kdiary | POST | `/dairySchedule/deleteEvent` | yes | — | — | — | yes | gated | — | — | — | — | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `kdiary-edit-report` | kdiary | POST | `/dairySchedule/editReport` | yes | — | — | — | yes | gated | — | — | — | — | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `kdiary-edit-schedule-event` | kdiary | POST | `/dairySchedule/editScheduleEvent` | yes | — | — | — | yes | gated | — | — | — | — | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `kdiary-get-event-date` | kdiary | POST | `/dairySchedule/getEventDate` | yes | yes | yes | yes | — | — | — | — | — | — | read | COVERED (contract) | contract-validated off live only |
| `kdiary-get-event-selected-date` | kdiary | POST | `/dairySchedule/getEventSelectedDate` | yes | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `kdiary-get-events` | kdiary | GET | `/dairySchedule/getEvents` | — | yes | yes | yes | yes | default | — | — | — | — | read | COVERED (contract + flow) | covered at every layer that applies to it |
| `kdiary-save-report` | kdiary | POST | `/dairySchedule/saveReport` | yes | — | — | — | yes | gated | — | — | — | — | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `kdiary-today-report` | kdiary | GET | `/dairySchedule/getTodayReport` | — | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `kdiary-today-schedules` | kdiary | GET | `/dairySchedule/getTodaySchedules` | — | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `kdiary-update-event` | kdiary | POST | `/dairySchedule/updateEvent` | yes | — | — | — | yes | gated | — | — | — | — | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `kdiary-update-remarks` | kdiary | POST | `/dairySchedule/updateScheduleRemarks` | yes | — | — | — | yes | gated | — | — | — | — | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `kos-access-activity` | kos | GET | `/kword/getAccessActivity/{docId}` | — | yes | yes | yes | yes | gated | — | — | — | — | read | COVERED (contract + flow) | covered at every layer that applies to it |
| `kos-ai-assist` | kos | POST | `/ai/messageAssist` | — | — | — | — | yes | gated | — | — | — | — | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `kos-ai-chat` | kos | POST | `/ai/chatResponse` | — | — | — | — | yes | gated | — | — | — | — | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `kos-ai-messages` | kos | GET | `/ai/messages/{sessionId}` | — | yes | yes | yes | — | — | — | — | — | — | read | COVERED (contract) | contract-validated off live only |
| `kos-ai-sessions` | kos | GET | `/ai/sessions` | — | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `kos-convert-to-kad` | kos | POST | `/kword/isConvertToKad` | yes | — | — | — | yes | gated | — | — | — | — | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `kos-create-doc` | kos | POST | `/kword/create` | — | — | — | — | yes | gated | — | — | — | — | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `kos-delete-doc` | kos | GET | `/kword/delete` | — | — | — | — | yes | gated | — | — | — | — | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `kos-delete-heading` | kos | POST | `/kword/deleteHeading` | yes | — | — | — | yes | gated | — | — | — | — | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `kos-exit-doc` | kos | GET | `/kword/exitDocument/{docId}` | — | — | — | — | yes | gated | — | — | — | — | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `kos-get-document` | kos | GET | `/kword/documents/{docId}` | — | yes | yes | yes | yes | gated | — | — | — | — | read | COVERED (contract + flow) | covered at every layer that applies to it |
| `kos-join-doc` | kos | POST | `/kword/joinDocument` | yes | — | — | — | yes | gated | — | — | — | — | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `kos-list-documents` | kos | GET | `/kword/documents/` | — | yes | yes | yes | — | — | — | — | — | — | read | COVERED (contract) | contract-validated off live only |
| `kos-presence` | kos | GET | `/kword/presence/{docId}` | — | yes | yes | yes | yes | gated | — | — | — | — | read | COVERED (contract + flow) | covered at every layer that applies to it |
| `kos-revisions` | kos | GET | `/kword/getAllRevision/{docId}` | — | yes | yes | yes | yes | gated | — | — | — | — | read | COVERED (contract + flow) | covered at every layer that applies to it |
| `kos-save-content` | kos | POST | `/kword/saveContent` | yes | — | — | — | yes | gated | — | — | — | — | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `kos-share-doc` | kos | POST | `/kword/share` | yes | — | — | — | yes | gated | — | — | — | — | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `kos-update-doc` | kos | POST | `/kword/update` | yes | — | — | — | yes | gated | — | — | — | — | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `list-dictionary-terms` | dictionary | GET | `/dictionary/terms` | yes | yes | yes | yes | — | — | — | — | — | — | mock fixture | COVERED (contract) | contract-validated off live only |
| `list-users` | users | GET | `/users` | yes | yes | yes | yes | — | — | — | — | — | — | mock fixture | COVERED (contract) | contract-validated off live only |
| `profile-advanced-search` | profile | POST | `/v2/profile/advancedSearch/` | yes | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `profile-auto-search` | profile | POST | `/v2/profile/autoSearchWithName/` | yes | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `profile-change-password` | profile | POST | `/v2/profile/changePassword` | yes | yes | yes | yes | yes | gated | — | — | — | — | global | COVERED (contract + flow) | covered at every layer that applies to it |
| `profile-convert-base64` | profile | POST | `/v2/profile/convertBase64ToImage` | yes | yes | yes | yes | yes | gated | — | — | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `profile-deactivate-account` | profile | POST | `/v2/profile/deactivateAccount/` | yes | yes | yes | yes | yes | gated | — | — | — | — | global / otp:requires | COVERED (contract + flow) | covered at every layer that applies to it |
| `profile-delete-college` | profile | POST | `/v2/profile/deleteCollegeDetail` | yes | yes | yes | yes | yes | gated | — | — | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `profile-delete-experience` | profile | POST | `/v2/profile/deleteExperienceDetail` | yes | yes | yes | yes | — | — | — | — | — | — | data | COVERED (contract) | contract-validated off live only |
| `profile-delete-school` | profile | POST | `/v2/profile/deleteSchoolDetail` | yes | yes | yes | yes | — | — | — | — | — | — | data | COVERED (contract) | contract-validated off live only |
| `profile-delete-university` | profile | POST | `/v2/profile/deleteUniversityDetail` | yes | yes | yes | yes | — | — | — | — | — | — | data | COVERED (contract) | contract-validated off live only |
| `profile-digital-card` | profile | POST | `/v2/profile/getDigitalCard/` | yes | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `profile-download-cover` | profile | GET | `/v2/profile/downloadCoverImage/{kpostID}` | — | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `profile-download-full-image` | profile | GET | `/v2/profile/downloadFullProfileImage/{kpostID}` | — | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `profile-download-image` | profile | GET | `/v2/profile/downloadProfileImage/{kpostID}` | — | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `profile-fetch-user-details` | profile | GET | `/v2/profile/fetchUserDetails/` | yes | yes | yes | yes | yes | default | — | — | — | yes | read | COVERED (contract + flow) | covered at every layer that applies to it |
| `profile-forgot-password-or-kpostid` | profile | POST | `/v2/profile/forgotPasswordOrKpostID/` | yes | yes | yes | — | yes | gated | — | — | — | — | external / otp:sends | COVERED (contract + flow) | security probes excluded (skipValidators, or the endpoint is unauthenticated) |
| `profile-get-languages` | profile | GET | `/v2/profile/getlanguages/` | — | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `profile-get-signature` | profile | GET | `/v2/profile/getSignatureImage` | — | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `profile-is-device-primary` | profile | GET | `/v2/profile/isDevicePrimaryOrNot/` | yes | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `profile-remove-cover` | profile | GET | `/v2/profile/removeCoverImage/` | yes | yes | yes | yes | yes | gated | — | — | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `profile-remove-image` | profile | GET | `/v2/profile/removeProfileImage/` | yes | yes | yes | yes | yes | gated | — | — | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `profile-save-college` | profile | POST | `/v2/profile/saveOrUpdateCollegeDetails/` | yes | yes | yes | yes | yes | gated | — | — | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `profile-save-experience` | profile | POST | `/v2/profile/saveOrUpdateExperienceDetails/` | yes | yes | yes | yes | — | — | — | — | — | — | data | COVERED (contract) | contract-validated off live only |
| `profile-save-other-activity` | profile | POST | `/v2/profile/saveOrUpdateOtherActivity/` | yes | yes | yes | yes | — | — | — | — | — | — | data | COVERED (contract) | contract-validated off live only |
| `profile-save-school` | profile | POST | `/v2/profile/saveOrUpdateSchoolDetails/` | yes | yes | yes | yes | — | — | — | — | — | — | data | COVERED (contract) | contract-validated off live only |
| `profile-save-university` | profile | POST | `/v2/profile/saveOrUpdateUniversityDetails/` | yes | yes | yes | yes | — | — | — | — | — | — | data | COVERED (contract) | contract-validated off live only |
| `profile-send-deactivation-otp` | profile | GET | `/v2/profile/sendAccountDeactivationOtp/` | — | yes | yes | yes | — | — | — | — | — | — | external / otp:sends | COVERED (contract) | contract-validated off live only |
| `profile-send-device-otp` | profile | GET | `/v2/profile/sendPrimaryOrSecondaryDeviceOtp/{requestType}` | — | yes | yes | yes | — | — | — | — | — | — | external / otp:sends | COVERED (contract) | contract-validated off live only |
| `profile-send-primary-device-otp` | profile | GET | `/v2/profile/sendPrimaryDeviceOtp/` | yes | yes | yes | yes | — | — | — | — | — | — | external / otp:sends | COVERED (contract) | contract-validated off live only |
| `profile-set-device-primary` | profile | POST | `/v2/profile/setDeviceAsPrimary/` | yes | yes | yes | yes | yes | gated | — | — | — | — | global / otp:requires | COVERED (contract + flow) | covered at every layer that applies to it |
| `profile-set-device-secondary` | profile | POST | `/v2/profile/setDeviceAsSecondary` | yes | yes | yes | yes | — | — | — | — | — | — | global / otp:requires | COVERED (contract) | contract-validated off live only |
| `profile-share-user-details` | profile | POST | `/v2/profile/shareUserDetails` | yes | yes | yes | yes | yes | gated | — | — | — | yes | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `profile-update-about` | profile | POST | `/v2/profile/updateAboutYourself/` | yes | yes | yes | yes | yes | gated | — | — | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `profile-update-basic` | profile | POST | `/v2/profile/updateBasicInformation/` | yes | yes | yes | yes | yes | gated | — | — | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `profile-update-contact` | profile | POST | `/v2/profile/updateContactInformation/` | yes | yes | yes | yes | yes | gated | — | — | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `profile-update-designation` | profile | POST | `/v2/profile/updateDesignation` | yes | yes | yes | yes | yes | gated | — | — | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `profile-update-device-primary` | profile | POST | `/v2/profile/updateDeviceAsPrimary/` | yes | yes | yes | yes | — | — | — | — | — | — | global / otp:requires | COVERED (contract) | contract-validated off live only |
| `profile-update-device-secondary` | profile | POST | `/v2/profile/updateDeviceAsSecondary` | yes | yes | yes | yes | — | — | — | — | — | — | global / otp:requires | COVERED (contract) | contract-validated off live only |
| `profile-update-image` | profile | POST | `/v2/profile/updateProfileImage/` | yes | yes | yes | yes | yes | gated | — | — | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `profile-update-privacy` | profile | POST | `/v2/profile/updatePrivacySettingDetails/` | yes | yes | yes | yes | yes | gated | — | — | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `profile-update-signature` | profile | POST | `/v2/profile/updateSignatureImage` | — | yes | yes | yes | yes | gated | — | — | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `profile-upload-attachments` | profile | POST | `/v2/profile/uploadProfileAttachments` | yes | yes | yes | yes | yes | gated | — | — | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `profile-upload-cover` | profile | POST | `/v2/profile/uploadCoverImage/` | yes | yes | yes | yes | yes | gated | — | — | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `profile-upload-image-s3` | profile | POST | `/v2/profile/uploadImageToS3` | — | yes | yes | yes | yes | gated | — | — | — | — | data | COVERED (contract + flow) | covered at every layer that applies to it |
| `profile-user-basic-by-kpostid` | profile | POST | `/v2/profile/getUserBasicDetailsUsingKpostID` | yes | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `profile-user-profile-by-kpostid` | profile | POST | `/v2/profile/getUserProfileUsingKpostID/` | yes | yes | yes | yes | yes | default | — | yes | — | — | read | COVERED (contract + flow) | covered at every layer that applies to it |
| `settings-change-theme` | settings | POST | `/generalSetting/changeTheme` | yes | — | — | — | yes | gated | — | — | — | — | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `settings-font` | settings | POST | `/generalSetting/fontSetting` | yes | — | — | — | yes | gated | — | — | — | — | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `settings-get-notifications` | settings | GET | `/generalSetting/getAllNotification` | — | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `settings-get-personalize` | settings | GET | `/generalSetting/getPersonalize` | — | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `settings-kall-notification` | settings | POST | `/generalSetting/kallNotification` | — | — | — | — | yes | gated | — | — | — | — | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `settings-katchup-notification` | settings | POST | `/generalSetting/katchupNotification` | — | — | — | — | yes | gated | — | — | — | — | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `settings-kmail-notification` | settings | POST | `/generalSetting/kmailNotification` | — | — | — | — | yes | gated | — | — | — | — | data | COVERED (flow only) | driven by a flow; no generated validator cases |
| `signup-login-active-session` | signup-login | GET | `/v2/signupLogin/getActiveSession` | yes | yes | yes | yes | — | default | — | — | — | — | read | COVERED (contract) | covered at every layer that applies to it |
| `signup-login-admin-registration` | signup-login | POST | `/v2/signupLogin/adminRegistration/` | yes | — | — | — | yes | gated | — | — | — | — | global / otp:requires | COVERED (flow only) | documented exclusion — see above |
| `signup-login-admin-user-login` | signup-login | POST | `/signupLoginForMediumAndLarge/adminUserLogin` | yes | yes | yes | — | — | — | — | — | — | — | read | COVERED (contract) | security probes excluded (skipValidators, or the endpoint is unauthenticated) |
| `signup-login-fetch-user-details` | signup-login | POST | `/v2/signupLogin/fetchUserDetails/` | yes | yes | yes | — | yes | default | — | yes | — | — | read | COVERED (contract + flow) | security probes excluded (skipValidators, or the endpoint is unauthenticated) |
| `signup-login-generate-jwt` | signup-login | POST | `/v2/signupLogin/generateJWTokens/` | yes | yes | yes | — | — | — | — | — | — | — | read | COVERED (contract) | security probes excluded (skipValidators, or the endpoint is unauthenticated) |
| `signup-login-kpost-id-exist` | signup-login | POST | `/v2/signupLogin/kpostIdExist/` | yes | yes | yes | — | yes | default | — | yes | — | yes | read | COVERED (contract + flow) | security probes excluded (skipValidators, or the endpoint is unauthenticated) |
| `signup-login-kpost-id-suggestions` | signup-login | POST | `/v2/signupLogin/kpostIDsuggestionList/` | yes | yes | yes | — | yes | default | — | — | — | yes | read | COVERED (contract + flow) | security probes excluded (skipValidators, or the endpoint is unauthenticated) |
| `signup-login-login-history` | signup-login | POST | `/v2/signupLogin/getLoginHistory` | — | yes | yes | yes | yes | default | — | — | — | yes | read | COVERED (contract + flow) | covered at every layer that applies to it |
| `signup-login-logout-all-devices` | signup-login | GET | `/v2/signupLogin/userLogoutFromAllDevices/` | — | yes | yes | yes | yes | gated | — | — | — | — | global | COVERED (contract + flow) | covered at every layer that applies to it |
| `signup-login-set-access-code` | signup-login | POST | `/v2/signupLogin/setAccessCode` | yes | yes | yes | yes | yes | gated | — | — | — | — | global | COVERED (contract + flow) | covered at every layer that applies to it |
| `signup-login-signup` | signup-login | POST | `/v2/signupLogin/signup/` | yes | — | — | — | yes | gated | — | yes | — | — | global / otp:requires | COVERED (flow only) | documented exclusion — see above |
| `signup-login-signup-get` | signup-login | GET | `/v2/signupLogin/signup/` | yes | yes | yes | — | yes | default | — | — | — | — | read | COVERED (contract + flow) | security probes excluded (skipValidators, or the endpoint is unauthenticated) |
| `signup-login-user-login` | signup-login | POST | `/v2/signupLogin/userLogin/` | yes | yes | yes | — | yes | default | — | yes | — | — | read | COVERED (contract + flow) | security probes excluded (skipValidators, or the endpoint is unauthenticated) |
| `signup-login-user-logout` | signup-login | POST | `/v2/signupLogin/userLogout/` | yes | — | — | — | yes | default | — | yes | — | — | data | COVERED (flow only) | documented exclusion — see above |
| `update-user` | users | PUT | `/users/{id}` | yes | yes | yes | yes | — | — | — | — | — | — | mock fixture | COVERED (contract) | contract-validated off live only |
