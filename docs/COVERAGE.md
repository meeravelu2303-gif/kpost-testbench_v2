# Coverage ledger — every endpoint, every screen

**GENERATED — do not edit.** Written by `tests/framework/coverage-ledger.spec.ts`
(`npm run test:framework`). It reconciles the registry against the generated contracts, so it
cannot drift from what is actually tested.

## API — endpoints

|                               |   Count |
| ----------------------------- | ------: |
| Documented (workbook, usable) |     334 |
| **Registered & tested**       | **212** |
| — of those, run on live       |      68 |
| In "built" modules            |     214 |

| Module                         | Documented | Tested | Live | Status         | Note                                                                   |
| ------------------------------ | ---------: | -----: | ---: | -------------- | ---------------------------------------------------------------------- |
| `profile`                      |         45 |     45 |   12 | built          | profile — full API + write lifecycle + screens                         |
| `katchup`                      |         36 |     36 |   10 | built          | messaging — full API + write lifecycle + screen                        |
| `common`                       |         32 |     32 |   14 | built          | reference data, identity, company, OTP (OTP writes gated)              |
| `kall`                         |         20 |     20 |    6 | built          | calling — full API + write lifecycle + screen                          |
| `contacts`                     |         16 |     16 |    8 | built          | address book — reads live, writes gated lifecycle                      |
| `dairyschedule`                |         14 |     14 |    5 | built          | KDiary — schedules/events/reports; reads live, writes gated            |
| `kword`                        |         14 |     14 |    1 | built          | KOS/KWord — document CRUD; reads live, writes gated (API-only)         |
| `signuplogin`                  |         12 |      8 |    6 | built          | login & session; signup out of scope (OTP-gated)                       |
| `group`                        |         11 |     11 |    0 | built          | group membership (FR-K06)                                              |
| `generalsetting`               |          7 |      7 |    2 | built          | Settings — theme/font/notifications; reads live, writes gated          |
| `ai`                           |          4 |      4 |    1 | built          | KOS K-AI — sessions read live; generation metered/external             |
| `dashboard`                    |          3 |      3 |    3 | built          | home recent-messages panel                                             |
| `kmail`                        |         80 |      0 |    0 | backlog        | KMail — compose, drafts, read, settings, translation (own host kmail5) |
| `aws`                          |          4 |      0 |    0 | backlog        | S3 presigned URLs (attachments)                                        |
| `other`                        |          1 |      0 |    0 | backlog        | unprefixed paths — review individually                                 |
| `admin`                        |         13 |      1 |    0 | needs-business | org/HR admin — needs a business company with members                   |
| `signuploginformediumandlarge` |          1 |      1 |    0 | needs-business | business-tier admin login                                              |
| `knews`                        |          6 |      0 |    0 | external       | external RSS feeds, not the KPost API                                  |
| `redbus`                       |          8 |      0 |    0 | out-of-scope   | third-party travel booking; confirm scope with owner                   |
| `kpresentation`                |          4 |      0 |    0 | out-of-scope   | KDOC — out of scope per BRD §4.2                                       |
| `ecommerce`                    |          2 |      0 |    0 | out-of-scope   | third-party commerce; confirm scope with owner                         |
| `metadee`                      |          1 |      0 |    0 | out-of-scope   | third-party; confirm scope with owner                                  |

### Uncovered documented paths (the backlog, module by module)

**`signuplogin`** (4) — built

- `/v2/signupLogin/adminRegistration/`
- `/v2/signupLogin/kpostIdExist/`
- `/v2/signupLogin/kpostIDsuggestionList/`
- `/v2/signupLogin/signup/`

**`kmail`** (80) — backlog

- `/kmail5/common/getKmailDashboardMsg/`
- `/kmail5/readMail/getKmailDetailsUsingKmailID/`
- `/kmail5/v2/kmailData/getKloudUsedData`
- `/kmail5/v2/readMail/downloadODAttachment`
- `/kmail5/v2/readMail/getCopiesInfo/{kmailID}`
- `/kmail5/v2/sentMail/postMail/`
- `/kmail5/v2/translator/translation/`
- `/v2/kmailSetting/deleteCustomizedInstantReply`
- `/v2/kmailSetting/saveOrUpdateCustomizedInstantReply`
- `/common/addOtherDomainContacts/`
- `/common/clearStatusOfAllKmailsContacts`
- `/common/clearStatusOfKmailsContacts/`
- `/common/convertMailAsPDF/`
- `/common/deleteKmailWithDeletedBy/`
- `/common/deleteOtherDomainContact/`
- `/common/editOtherDomainContactsDetails/`
- `/common/frequentKmailContact/`
- `/common/getAllImportantMails/`
- `/common/getAllMailCount`
- `/common/getBulkKmailDashboardMsg`
- `/common/getInstantReply/`
- `/common/getKmailDashboardMsg/`
- `/common/getSaluations/`
- `/common/kmailGroupReadStatus/`
- `/common/knownPostBoxContacts/`
- `/common/mailSubjectSelectedContact/`
- `/common/miscellaneousContacts/`
- `/common/postBoxContacts/`
- `/common/replyNotReceived/`
- `/common/replyNotRequiredByReceiver/`
- `/common/replyNotRequiredBySender/`
- `/common/replyNotSent/`
- `/common/selectedContactMails/`
- `/common/sentMailNotOpened/`
- `/common/setKmailAsImportant/`
- `/common/statusOfKmailsContactsTotalCount/`
- `/common/statusOfKmailsContactsWithCount/`
- `/common/unOpenedMailCountBySenderID/`
- `/draft/deleteDraftMail/`
- `/draft/draftMail/`
- `/draft/draftMailMultiPart`
- `/draft/getAllDraftMails/`
- `/draft/getDraftMailsContacts/`
- `/draft/getDraftMailsForSelectedContact/`
- `/kmailSetting/deleteCustomizedInstantReply`
- `/kmailSetting/deleteCustomizedSaluation`
- `/kmailSetting/deleteLetterHead`
- `/kmailSetting/getAllLetterHead`
- `/kmailSetting/getDigitalSignature`
- `/kmailSetting/getLetterHead`
- `/kmailSetting/getLetterHeadTemplate`
- `/kmailSetting/getMailCountDaysLimit`
- `/kmailSetting/getMailSignature`
- `/kmailSetting/saveOrUpdateCustomizedInstantReply`
- `/kmailSetting/saveOrUpdateCustomizedSaluations`
- `/kmailSetting/saveOrUpdateMailSignature`
- `/kmailSetting/saveOrUpdateMailSignatureCompanyData`
- `/kmailSetting/saveOrUpdateMailSignatureGraphics`
- `/kmailSetting/saveOrUpdateMailSignaturePersonalData`
- `/kmailSetting/saveOrUpdateMailSignatureSocialMediaLink`
- `/kmailSetting/saveOrUpdateMailSignatureStyle`
- `/kmailSetting/saveOrUpdateMailSignatureTemplateId`
- `/kmailSetting/setLetterHead`
- `/kmailSetting/updateMailCountDaysLimit`
- `/readMail/download/{uuid}`
- `/readMail/downloadThumbnail/{uuid}`
- `/readMail/draftMailContent`
- `/readMail/getCopiesInfo/{kmailID}`
- `/readMail/getKmailDetailsUsingKmailID`
- `/readMail/mediaStreaming/{uuid}`
- `/readMail/referenceMailContent/`
- `/readMail/sentAndInboxMailContent/`
- `/sentMail/bulkMail/status/{fromAddress}`
- `/sentMail/getMailCredentials/`
- `/sentMail/loadOtherDomainMails/`
- `/sentMail/postBulkMail`
- `/translator/translation/`
- `/v2/aws/generate-presigned-url`
- `/v2/readMail/downloadODAttachment`
- `/v2/sentMail/postMail/`

**`aws`** (4) — backlog

- `/v2/aws/checkAttachmentS3/`
- `/v2/aws/deleteAttachmentFromS3/{uuid}`
- `/v2/aws/generate-presigned-url`
- `/v2/aws/katchup/generate-presigned-url`

**`other`** (1) — backlog

- `/delete?presentationId={presentationId}`

**`admin`** (12) — needs-business

- `/admin/addingUserByAdmin/`
- `/admin/createOrRemoveBackupAdmin/`
- `/admin/displayNameSuggestion`
- `/admin/getBankAndCompanyDetails/{companyID}`
- `/admin/holdOrRelease/`
- `/admin/resetPassword/`
- `/admin/terminateUser/`
- `/admin/userManagementDetails/{companyID}`
- `/v2/admin/createKpostIDAndDesignationSuggestion`
- `/v2/admin/updateBankAccountDetails`
- `/v2/admin/updateCompanyDetails`
- `/v2/admin/updateRole`

**`knews`** (6) — external

- `/v2/knews/getAllCategories/`
- `/v2/knews/getAllNewsSource/`
- `/v2/knews/getKnewsSettings/`
- `/v2/knews/getPublicationByLanguageId/`
- `/v2/knews/getSubCategoriesByCategoryId/`
- `/v2/knews/updateKnewsSettings/`

**`redbus`** (8) — out-of-scope

- `/redbus/availabletrips/`
- `/redbus/blockTicket/{kpostId}`
- `/redbus/boardingPoint/`
- `/redbus/citysuggestion/chennai`
- `/redbus/destinations/`
- `/redbus/tripdetails/`
- `/redbus/tripdetailsV2/`
- `/redbus/updatecitylist`

**`kpresentation`** (4) — out-of-scope

- `/kpresentation/create`
- `/kpresentation/presentations`
- `/kpresentation/presentations/{presentationId}`
- `/kpresentation/savePresentation`

**`ecommerce`** (2) — out-of-scope

- `/v2/ecommerce/getAll`
- `/v2/ecommerce/getEcommerceDetails/`

**`metadee`** (1) — out-of-scope

- `/metaDee/aiMessage`

## Screens

Covered: **8 / 15** routes.

| Route             | e2e spec           | Note                             |
| ----------------- | ------------------ | -------------------------------- |
| `/login`          | `login.spec.ts`    | two-step login                   |
| `/home`           | `home.spec.ts`     | landing + recent panel           |
| `(shell)`         | `shell.spec.ts`    | header + nav rail (all screens)  |
| `/katchup`        | `katchup.spec.ts`  | messaging                        |
| `/kall`           | `kall.spec.ts`     | calling                          |
| `/kmail`          | `kmail.spec.ts`    | email                            |
| `/userprofile`    | `profile.spec.ts`  | profile + settings               |
| `/settings`       | `settings.spec.ts` | settings workspace               |
| `/kdirectory`     | —                  | out of scope per BRD §4.2        |
| `/kcloud`         | —                  | backlog                          |
| `/kbooking`       | —                  | backlog / third-party            |
| `/knews`          | —                  | external RSS                     |
| `/e-commerce`     | —                  | third-party; confirm scope       |
| `/kdoc`           | —                  | KOS "Coming Soon" today          |
| `/usermanagement` | —                  | admin — needs a business account |

## What "complete" is blocked on

- **OTP-gated endpoints never run on live** (no bypass — a security property). `npm run contract:otp`.
- **`needs-business` modules** (admin, business-tier login) need a business company with members.
- **`external`/`out-of-scope`** modules (KNews RSS, RedBus/ECommerce/MetaDee, KDOC) await an owner
  scope decision or are excluded per the BRD.
