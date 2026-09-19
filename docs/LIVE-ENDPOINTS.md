# Live endpoints — what we can and cannot test

**GENERATED — do not edit.** Written by `tests/framework/live-coverage.spec.ts`
(`npm run test:framework`). Edit the endpoint definitions, not this file.

Target: the live application (`devapi2.kpostindia.com`). Scope: PERSONAL accounts plus the
BUSINESS_S/M/L company accounts (company reads + user-management now run on live).
A clear per-reason list of what stays blocked is in `docs/BLOCKED-ENDPOINTS.md`.

| | Count |
| - | ----: |
| **Runs on live** | **122** |
| Blocked | 214 |
| Total registered | 336 |

---

## Runs on live — 122

Every one is read-only, needs no company, and uses identifiers that are set in `.env`.
Reaching this list requires `productionSafe: true` on the definition, which is a claim a
reviewer can check against the comment beside it.

| Method | Path | Module |
| ------ | ---- | ------ |
| `POST` | `/adminTierAttribute/getAttributeByCompanyId` | Admin |
| `POST` | `/adminTierVariable/getAdminTierVariable` | Admin |
| `GET` | `/country/getAddressUsingPincodeAndCountry/{pincode}/{country}` | Admin |
| `POST` | `/employeeDetails/getEmployeeDetails` | Admin |
| `POST` | `/hrSetUpTierAttribute/getAttributeByCompanyId` | Admin |
| `POST` | `/hrSetUpTierVariable/getHrSetUpTierVariable` | Admin |
| `POST` | `/location/getAllLocation` | Admin |
| `POST` | `/rolePosting/getEmployeeByCompanyId` | Admin |
| `POST` | `/rolePosting/getRolePostingByCompanyId` | Admin |
| `POST` | `/rolePosting/getSuspendOrTerminateEmployee` | Admin |
| `POST` | `/v2/aws/checkAttachmentS3/` | AWS |
| `POST` | `/v2/aws/generate-presigned-url` | AWS |
| `GET` | `/v2/common/countries` | common |
| `POST` | `/v2/common/domain/` | common |
| `POST` | `/v2/common/generateDomainAndUniqueName` | common |
| `POST` | `/v2/common/getCitiesByRegionId/` | common |
| `POST` | `/v2/common/getDesignation/` | common |
| `GET` | `/v2/common/getFlutterAppVersion/` | common |
| `POST` | `/v2/common/getKpostIdUsingModule` | common |
| `GET` | `/v2/common/getStates/` | common |
| `POST` | `/v2/common/getTotalCountByDate` | common |
| `POST` | `/v2/common/getUserDetailsByMobNo` | common |
| `POST` | `/v2/common/languages` | common |
| `POST` | `/v2/common/mobileNoExist/` | common |
| `POST` | `/v2/common/mobileNoExistInsideCompany/` | common |
| `GET` | `/v2/common/msStatus/` | common |
| `POST` | `/v2/common/pinCode` | common |
| `POST` | `/v2/common/postalPinCode/` | common |
| `POST` | `/v2/common/uniqueNameExist` | common |
| `POST` | `/admin/displayNameSuggestion` | common · company |
| `GET` | `/admin/getBankAndCompanyDetails/{companyID}` | common · company |
| `GET` | `/admin/userManagementDetails/{companyID}` | common · company |
| `POST` | `/v2/admin/createKpostIDAndDesignationSuggestion` | common · company |
| `POST` | `/v2/common/getCompanyDetails` | common · company |
| `POST` | `/v2/common/getCompanyDetailsByAdmin` | common · company |
| `POST` | `/v2/common/getCompanyDetailsByMobileNoAndproductId` | common · company |
| `GET` | `/v2/common/getCompanyNameExistOnKpostAndKsmacc/{companyName}` | common · company |
| `GET` | `/kmail5/v2/common/frequentKmailContact/` | Contacts |
| `POST` | `/kmail5/v2/common/knownPostBoxContacts/` | Contacts |
| `GET` | `/kmail5/v2/common/miscellaneousContacts/` | Contacts |
| `POST` | `/kmail5/v2/common/postBoxContacts/` | Contacts |
| `GET` | `/v2/contacts/getblockContactDetails` | Contacts |
| `GET` | `/v2/contacts/getImportedPhoneContacts/` | Contacts |
| `POST` | `/v2/contacts/getSearchDetails/` | Contacts |
| `POST` | `/v2/contacts/globalSearch/` | Contacts |
| `POST` | `/v2/contacts/myContacts/` | Contacts |
| `POST` | `/v2/contacts/myGroups/` | Contacts |
| `POST` | `/v2/contacts/myUnknownGroups/` | Contacts |
| `POST` | `/v2/contacts/myUnknownKatchupContacts/` | Contacts |
| `POST` | `/v2/kall/contactInfo/` | Kall |
| `POST` | `/v2/kall/fetchScheduledRepeatKall` | Kall |
| `GET` | `/v2/kall/frequentKallContacts` | Kall |
| `POST` | `/v2/kall/kallDashboard` | Kall |
| `POST` | `/v2/kall/kallInfo` | Kall |
| `GET` | `/v2/kall/todayKoolKall/` | Kall |
| `POST` | `/v2/aws/katchup/generate-presigned-url` | Katchup |
| `POST` | `/v2/katchup/filterKatchUpMessage/` | Katchup |
| `GET` | `/v2/katchup/frequentlyAccessContacts` | Katchup |
| `GET` | `/v2/katchup/getAllReportMsg` | Katchup |
| `GET` | `/v2/katchup/getKatchupMessagesSubject` | Katchup |
| `GET` | `/v2/katchup/getUnopenedMessagesAndKmailsTotalCount/` | Katchup |
| `GET` | `/v2/katchup/getUnopenedMessagesCount/` | Katchup |
| `POST` | `/v2/katchup/katchupMessagesForSelectedContactID/` | Katchup |
| `POST` | `/v2/katchup/messageCountBetweenSenderAndReceiver/` | Katchup |
| `POST` | `/v2/katchup/searchKatchUpMessage/` | Katchup |
| `POST` | `/v2/katchup/searchKatchUpMessageSubject` | Katchup |
| `POST` | `/dairySchedule/getEventDate` | KDiary |
| `GET` | `/dairySchedule/getEvents` | KDiary |
| `POST` | `/dairySchedule/getEventSelectedDate` | KDiary |
| `GET` | `/dairySchedule/getTodayReport` | KDiary |
| `GET` | `/dairySchedule/getTodaySchedules` | KDiary |
| `POST` | `/kmail5/v2/common/getAllImportantMails/` | KMail |
| `POST` | `/kmail5/v2/common/getAllMailCount` | KMail |
| `POST` | `/kmail5/v2/common/getBulkKmailDashboardMsg` | KMail |
| `POST` | `/kmail5/v2/common/getKmailDashboardMsg/` | KMail |
| `GET` | `/kmail5/v2/common/getSaluations/` | KMail |
| `POST` | `/kmail5/v2/common/mailSubjectSelectedContact/` | KMail |
| `POST` | `/kmail5/v2/common/replyNotReceived/` | KMail |
| `POST` | `/kmail5/v2/common/replyNotSent/` | KMail |
| `POST` | `/kmail5/v2/common/selectedContactMails/` | KMail |
| `POST` | `/kmail5/v2/common/sentMailNotOpened/` | KMail |
| `GET` | `/kmail5/v2/common/statusOfKmailsContactsTotalCount/` | KMail |
| `POST` | `/kmail5/v2/common/statusOfKmailsContactsWithCount/` | KMail |
| `GET` | `/kmail5/v2/common/unOpenedMailCountBySenderID/` | KMail |
| `GET` | `/kmail5/v2/draft/getAllDraftMails/` | KMail |
| `GET` | `/kmail5/v2/draft/getDraftMailsContacts/` | KMail |
| `POST` | `/kmail5/v2/draft/getDraftMailsForSelectedContact/` | KMail |
| `POST` | `/kmail5/v2/readMail/referenceMailContent/` | KMail |
| `GET` | `/kmail5/v2/sentMail/loadOtherDomainMails/` | KMail |
| `POST` | `/kmail5/v2/translator/translation/` | KMail |
| `GET` | `/ai/sessions` | KOS |
| `GET` | `/kword/documents/` | KOS |
| `POST` | `/v2/signupLogin/fetchUserDetails/` | Login & session |
| `POST` | `/v2/signupLogin/generateJWTokens/` | Login & session |
| `GET` | `/v2/signupLogin/getActiveSession` | Login & session |
| `POST` | `/v2/signupLogin/getLoginHistory` | Login & session |
| `POST` | `/v2/signupLogin/userLogin/` | Login & session |
| `POST` | `/v2/signupLogin/userLogout/` | Login & session |
| `POST` | `/v2/dashboard/homeDashboardMsgs/` | other |
| `POST` | `/v2/dashboard/homeDashboardNewMsgs` | other |
| `POST` | `/v2/dashboard/katchupDashboardMsg/` | other |
| `POST` | `/v2/profile/advancedSearch/` | Profile |
| `POST` | `/v2/profile/autoSearchWithName/` | Profile |
| `GET` | `/v2/profile/downloadCoverImage/{kpostID}` | Profile |
| `GET` | `/v2/profile/downloadFullProfileImage/{kpostID}` | Profile |
| `GET` | `/v2/profile/downloadProfileImage/{kpostID}` | Profile |
| `GET` | `/v2/profile/fetchUserDetails/` | Profile |
| `POST` | `/v2/profile/getDigitalCard/` | Profile |
| `GET` | `/v2/profile/getlanguages/` | Profile |
| `GET` | `/v2/profile/getSignatureImage` | Profile |
| `POST` | `/v2/profile/getUserBasicDetailsUsingKpostID` | Profile |
| `POST` | `/v2/profile/getUserProfileUsingKpostID/` | Profile |
| `GET` | `/v2/profile/isDevicePrimaryOrNot/` | Profile |
| `GET` | `/generalSetting/getAllNotification` | Settings |
| `GET` | `/generalSetting/getPersonalize` | Settings |
| `GET` | `/kmail5/v2/common/getInstantReply/` | Settings |
| `GET` | `/kmail5/v2/kmailSetting/getAllLetterHead` | Settings |
| `GET` | `/kmail5/v2/kmailSetting/getDigitalSignature` | Settings |
| `GET` | `/kmail5/v2/kmailSetting/getLetterHead` | Settings |
| `GET` | `/kmail5/v2/kmailSetting/getLetterHeadTemplate` | Settings |
| `GET` | `/kmail5/v2/kmailSetting/getMailCountDaysLimit` | Settings |
| `GET` | `/kmail5/v2/kmailSetting/getMailSignature` | Settings |

---

## Blocked on live — 214

Not failures — these are refused before a request is sent, each for a stated reason.

| Method | Path | Module | Why |
| ------ | ---- | ------ | --- |
| `POST` | `/adminTierAttribute/delete` | Admin | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/adminTierAttribute/save` | Admin | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/adminTierAttribute/update` | Admin | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/adminTierVariable/delete` | Admin | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/adminTierVariable/getAllReportingVariableHierarchy` | Admin | COVERED via admin lifecycle: read keyed by a runtime ObjectId the create-sequence mints |
| `POST` | `/adminTierVariable/save` | Admin | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/adminTierVariable/update` | Admin | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/employeeDetails/delete` | Admin | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/employeeDetails/save` | Admin | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/employeeDetails/update` | Admin | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/hrSetUpTierAttribute/delete` | Admin | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/hrSetUpTierAttribute/save` | Admin | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/hrSetUpTierAttribute/update` | Admin | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/hrSetUpTierVariable/delete` | Admin | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/hrSetUpTierVariable/getAllReportingHrTierVariableHierarchy` | Admin | COVERED via admin lifecycle: read keyed by a runtime ObjectId the create-sequence mints |
| `POST` | `/hrSetUpTierVariable/save` | Admin | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/hrSetUpTierVariable/update` | Admin | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/location/delete` | Admin | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/location/getLocation` | Admin | COVERED via admin lifecycle: read keyed by a runtime ObjectId the create-sequence mints |
| `POST` | `/location/getLocationById` | Admin | COVERED via admin lifecycle: read keyed by a runtime ObjectId the create-sequence mints |
| `POST` | `/location/save` | Admin | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/location/update` | Admin | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/rolePosting/delete` | Admin | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/rolePosting/getRolePostingByCompanyIdAndEmployeeId` | Admin | COVERED via admin lifecycle: read keyed by a runtime ObjectId the create-sequence mints |
| `POST` | `/rolePosting/save` | Admin | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/rolePosting/suspendOrTerminateEmployee` | Admin | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/rolePosting/update` | Admin | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/workplaceHierarchy/getWorkPlaceHierarchy` | Admin | OFF-LIVE: read needs setup we do not have (business-tier login answers 403; company logo 500s) |
| `GET` | `/v2/aws/deleteAttachmentFromS3/{uuid}` | AWS | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/common/forgotPasswordOTPOrSentKpostIDSms` | common | OFF-LIVE (OTP): sends a real OTP by SMS/email to a real recipient |
| `POST` | `/v2/common/forgotPasswordUpdate` | common | OFF-LIVE (OTP): needs an OTP validated in an earlier step; live has no bypass |
| `POST` | `/v2/common/saveEnquiryDetails` | common | OFF-LIVE by choice: persists a real shared record (enquiry / unsubscribe) — no self-cleaning lifecycle |
| `POST` | `/v2/common/saveUnsubscriberDetails` | common | OFF-LIVE by choice: persists a real shared record (enquiry / unsubscribe) — no self-cleaning lifecycle |
| `POST` | `/v2/common/sendOTP/` | common | OFF-LIVE (OTP): sends a real OTP by SMS/email to a real recipient |
| `POST` | `/v2/common/sendOTPtoMail/` | common | OFF-LIVE (OTP): sends a real OTP by SMS/email to a real recipient |
| `POST` | `/v2/common/updateFlutterAppVersion` | common | OFF-LIVE by choice: writes state shared by the whole environment (no self-cleaning lifecycle) |
| `POST` | `/v2/common/validateMailOTP/` | common | OFF-LIVE (OTP): needs a real OTP in its payload; live has no bypass |
| `POST` | `/v2/common/validateOTP/` | common | OFF-LIVE (OTP): needs a real OTP in its payload; live has no bypass |
| `POST` | `/admin/addingUserByAdmin/` | common · company | OFF-LIVE by choice: writes state shared by the whole environment (no self-cleaning lifecycle) |
| `POST` | `/admin/createOrRemoveBackupAdmin/` | common · company | OFF-LIVE by choice: writes state shared by the whole environment (no self-cleaning lifecycle) |
| `POST` | `/admin/holdOrRelease/` | common · company | OFF-LIVE by choice: writes state shared by the whole environment (no self-cleaning lifecycle) |
| `POST` | `/admin/removeCompanyLogo` | common · company | OFF-LIVE by choice: writes state shared by the whole environment (no self-cleaning lifecycle) |
| `POST` | `/admin/resetPassword/` | common · company | OFF-LIVE by choice: writes state shared by the whole environment (no self-cleaning lifecycle) |
| `POST` | `/admin/terminateUser/` | common · company | OFF-LIVE by choice: writes state shared by the whole environment (no self-cleaning lifecycle) |
| `POST` | `/v2/admin/updateBankAccountDetails` | common · company | OFF-LIVE by choice: writes state shared by the whole environment (no self-cleaning lifecycle) |
| `POST` | `/v2/admin/updateCompanyDetails` | common · company | OFF-LIVE by choice: writes state shared by the whole environment (no self-cleaning lifecycle) |
| `POST` | `/v2/admin/updateRole` | common · company | OFF-LIVE by choice: writes state shared by the whole environment (no self-cleaning lifecycle) |
| `GET` | `/v2/common/downloadCompanyLogo/{companyID}` | common · company | OFF-LIVE: read needs setup we do not have (business-tier login answers 403; company logo 500s) |
| `POST` | `/v2/common/updateCompanyLogo` | common · company | OFF-LIVE by choice: writes state shared by the whole environment (no self-cleaning lifecycle) |
| `POST` | `/v2/contacts/addContact` | Contacts | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/contacts/addContactReference/` | Contacts | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/contacts/addMultipleContact` | Contacts | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/contacts/blockOrUnBlockContact/` | Contacts | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/contacts/blockOrUnBlockMultipleContact` | Contacts | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/contacts/deleteContact/` | Contacts | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/contacts/importPhoneContacts/` | Contacts | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/contacts/updateInviteStatus/` | Contacts | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/group/addOrRemoveAdminAccess/` | Group | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/group/addUserToGroup/` | Group | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/group/createUserGroup/` | Group | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/group/deleteGroup` | Group | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `GET` | `/v2/group/downloadGroupFullProfileImage/{groupKpostID}/{kpostID}` | Group | COVERED via lifecycle: read keyed by a runtime id (message / call / group / document) a write flow mints |
| `GET` | `/v2/group/downloadGroupProfileImage/{groupKpostID}/{kpostID}` | Group | COVERED via lifecycle: read keyed by a runtime id (message / call / group / document) a write flow mints |
| `POST` | `/v2/group/editGroupName` | Group | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/group/leaveFromGroup/` | Group | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/group/removeGroupMember/` | Group | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/group/removeGroupProfileImage` | Group | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/group/updateGroupProfileImage/` | Group | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/kall/clearKallBykallIds` | Kall | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `GET` | `/v2/kall/clearKallHistory` | Kall | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/kall/endIndividualKall/` | Kall | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/kall/endKoolKall` | Kall | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/kall/getKallStatus` | Kall | COVERED via lifecycle: read keyed by a runtime id (message / call / group / document) a write flow mints |
| `POST` | `/v2/kall/getKallStatusUsingKallID` | Kall | COVERED via lifecycle: read keyed by a runtime id (message / call / group / document) a write flow mints |
| `POST` | `/v2/kall/initiateKall` | Kall | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/kall/joinScheduleKall` | Kall | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/kall/modifyKallMembers` | Kall | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/kall/reScheduleKall` | Kall | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/kall/scheduledKall` | Kall | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/kall/scheduledRepeatKall` | Kall | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/kall/updateKallStatus` | Kall | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/kall/updateSenderAndReceiverKallStatus` | Kall | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/katchup/deleteKatchUpMessage/` | Katchup | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `GET` | `/v2/katchup/download/{uuid}` | Katchup | OFF-LIVE: needs a real uploaded attachment (S3 file upload) — the one file-upload gap |
| `GET` | `/v2/katchup/downloadAttachment/{uuid}` | Katchup | COVERED via lifecycle: read keyed by a runtime id (message / call / group / document) a write flow mints |
| `GET` | `/v2/katchup/downloadFromS3/{uuid}` | Katchup | COVERED via lifecycle: read keyed by a runtime id (message / call / group / document) a write flow mints |
| `GET` | `/v2/katchup/downloadThumbnail/{uuid}` | Katchup | OFF-LIVE: needs a real uploaded attachment (S3 file upload) — the one file-upload gap |
| `POST` | `/v2/katchup/forwardKatchupMessage/` | Katchup | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/katchup/forwardKatchupMessageNew` | Katchup | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/katchup/forwardKatchupMultipleMsgs` | Katchup | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/katchup/forwardMessageBacktrackByMsgID` | Katchup | COVERED via lifecycle: read keyed by a runtime id (message / call / group / document) a write flow mints |
| `POST` | `/v2/katchup/generateThumbnailUsingUUID` | Katchup | OFF-LIVE: needs a real uploaded attachment (S3 file upload) — the one file-upload gap |
| `POST` | `/v2/katchup/getBulkMessageInfo/` | Katchup | COVERED via lifecycle: read keyed by a runtime id (message / call / group / document) a write flow mints |
| `POST` | `/v2/katchup/getMessagesByReferenceMessageList` | Katchup | COVERED via lifecycle: read keyed by a runtime id (message / call / group / document) a write flow mints |
| `POST` | `/v2/katchup/getReadStatusGroupMessage/` | Katchup | COVERED via lifecycle: read keyed by a runtime id (message / call / group / document) a write flow mints |
| `POST` | `/v2/katchup/getReferenceMSGDetails/` | Katchup | COVERED via lifecycle: read keyed by a runtime id (message / call / group / document) a write flow mints |
| `GET` | `/v2/katchup/getSharedMessageDetails/{msgID}` | Katchup | COVERED via lifecycle: read keyed by a runtime id (message / call / group / document) a write flow mints |
| `POST` | `/v2/katchup/getSharedMessageInfo/` | Katchup | COVERED via lifecycle: read keyed by a runtime id (message / call / group / document) a write flow mints |
| `POST` | `/v2/katchup/markOrUnmarkImportantMessage/` | Katchup | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `GET` | `/v2/katchup/mediaStreaming/{uuid}` | Katchup | OFF-LIVE: needs a real uploaded attachment (S3 file upload) — the one file-upload gap |
| `POST` | `/v2/katchup/recallMessage/` | Katchup | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/katchup/reportAbuse` | Katchup | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/katchup/saveKatchupMessages/` | Katchup | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/katchup/sendBulkKatchupMsg` | Katchup | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/katchup/sendBulkKatchupMsgMultiPart/` | Katchup | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/katchup/sendKatchupMsgMultiPart/` | Katchup | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/katchup/sendMessage/` | Katchup | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/katchup/sendMessageForForwardSelectedAttachment` | Katchup | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/dairySchedule/addparticipants` | KDiary | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/dairySchedule/createEvent` | KDiary | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/dairySchedule/createSchedule` | KDiary | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/dairySchedule/deleteEvent` | KDiary | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/dairySchedule/editReport` | KDiary | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/dairySchedule/editScheduleEvent` | KDiary | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/dairySchedule/saveReport` | KDiary | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/dairySchedule/updateEvent` | KDiary | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/dairySchedule/updateScheduleRemarks` | KDiary | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/kmail5/v2/common/addOtherDomainContacts/` | KMail | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/kmail5/v2/common/clearStatusOfAllKmailsContacts` | KMail | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/kmail5/v2/common/clearStatusOfKmailsContacts/` | KMail | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/kmail5/v2/common/convertMailAsPDF/` | KMail | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/kmail5/v2/common/deleteKmailWithDeletedBy/` | KMail | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/kmail5/v2/common/deleteOtherDomainContact/` | KMail | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/kmail5/v2/common/editOtherDomainContactsDetails/` | KMail | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/kmail5/v2/common/kmailGroupReadStatus/` | KMail | COVERED via KMail lifecycle: read keyed by a real mail / kmailID a send flow mints |
| `POST` | `/kmail5/v2/common/replyNotRequiredByReceiver/` | KMail | COVERED via KMail lifecycle: read keyed by a real mail / kmailID a send flow mints |
| `POST` | `/kmail5/v2/common/replyNotRequiredBySender/` | KMail | COVERED via KMail lifecycle: read keyed by a real mail / kmailID a send flow mints |
| `POST` | `/kmail5/v2/common/setKmailAsImportant/` | KMail | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/kmail5/v2/draft/deleteDraftMail/` | KMail | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/kmail5/v2/draft/draftMail/` | KMail | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/kmail5/v2/draft/draftMailMultiPart` | KMail | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `GET` | `/kmail5/v2/readMail/download/{uuid}` | KMail | OFF-LIVE: needs a real uploaded attachment (S3 file upload) — the one file-upload gap |
| `POST` | `/kmail5/v2/readMail/downloadODAttachment` | KMail | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `GET` | `/kmail5/v2/readMail/downloadThumbnail/{uuid}` | KMail | OFF-LIVE: needs a real uploaded attachment (S3 file upload) — the one file-upload gap |
| `POST` | `/kmail5/v2/readMail/draftMailContent` | KMail | COVERED via KMail lifecycle: read keyed by a real mail / kmailID a send flow mints |
| `GET` | `/kmail5/v2/readMail/getCopiesInfo/{kmailID}` | KMail | COVERED via lifecycle: read keyed by a runtime id (message / call / group / document) a write flow mints |
| `POST` | `/kmail5/v2/readMail/getKmailDetailsUsingKmailID` | KMail | COVERED via KMail lifecycle: read keyed by a real mail / kmailID a send flow mints |
| `GET` | `/kmail5/v2/readMail/mediaStreaming/{uuid}` | KMail | OFF-LIVE: needs a real uploaded attachment (S3 file upload) — the one file-upload gap |
| `POST` | `/kmail5/v2/readMail/sentAndInboxMailContent/` | KMail | COVERED via KMail lifecycle: read keyed by a real mail / kmailID a send flow mints |
| `GET` | `/kmail5/v2/sentMail/bulkMail/status/{fromAddress}` | KMail | COVERED via KMail lifecycle: read keyed by a real mail / kmailID a send flow mints |
| `POST` | `/kmail5/v2/sentMail/getMailCredentials/` | KMail | OFF-LIVE by choice: writes state shared by the whole environment (no self-cleaning lifecycle) |
| `POST` | `/kmail5/v2/sentMail/postBulkMail` | KMail | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/kmail5/v2/sentMail/postMail/` | KMail | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/ai/chatResponse` | KOS | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/ai/messageAssist` | KOS | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `GET` | `/ai/messages/{sessionId}` | KOS | COVERED via lifecycle: read keyed by a runtime id (message / call / group / document) a write flow mints |
| `POST` | `/kword/create` | KOS | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `GET` | `/kword/delete` | KOS | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/kword/deleteHeading` | KOS | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `GET` | `/kword/documents/{docId}` | KOS | COVERED via lifecycle: read keyed by a runtime id (message / call / group / document) a write flow mints |
| `GET` | `/kword/exitDocument/{docId}` | KOS | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `GET` | `/kword/getAccessActivity/{docId}` | KOS | COVERED via lifecycle: read keyed by a runtime id (message / call / group / document) a write flow mints |
| `GET` | `/kword/getAllRevision/{docId}` | KOS | COVERED via lifecycle: read keyed by a runtime id (message / call / group / document) a write flow mints |
| `POST` | `/kword/isConvertToKad` | KOS | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/kword/joinDocument` | KOS | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `GET` | `/kword/presence/{docId}` | KOS | COVERED via lifecycle: read keyed by a runtime id (message / call / group / document) a write flow mints |
| `POST` | `/kword/saveContent` | KOS | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/kword/share` | KOS | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/kword/update` | KOS | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/signupLoginForMediumAndLarge/adminUserLogin` | Login & session | OFF-LIVE: read needs setup we do not have (business-tier login answers 403; company logo 500s) |
| `POST` | `/v2/signupLogin/setAccessCode` | Login & session | OFF-LIVE by choice: writes state shared by the whole environment (no self-cleaning lifecycle) |
| `GET` | `/v2/signupLogin/userLogoutFromAllDevices/` | Login & session | OFF-LIVE by choice: writes state shared by the whole environment (no self-cleaning lifecycle) |
| `POST` | `/v2/profile/changePassword` | Profile | OFF-LIVE by choice: writes state shared by the whole environment (no self-cleaning lifecycle) |
| `POST` | `/v2/profile/convertBase64ToImage` | Profile | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/profile/deactivateAccount/` | Profile | OFF-LIVE (OTP): needs an OTP validated in an earlier step; live has no bypass |
| `POST` | `/v2/profile/deleteCollegeDetail` | Profile | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/profile/deleteExperienceDetail` | Profile | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/profile/deleteSchoolDetail` | Profile | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/profile/deleteUniversityDetail` | Profile | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/profile/forgotPasswordOrKpostID/` | Profile | OFF-LIVE (OTP): sends a real OTP by SMS/email to a real recipient |
| `GET` | `/v2/profile/removeCoverImage/` | Profile | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `GET` | `/v2/profile/removeProfileImage/` | Profile | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/profile/saveOrUpdateCollegeDetails/` | Profile | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/profile/saveOrUpdateExperienceDetails/` | Profile | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/profile/saveOrUpdateOtherActivity/` | Profile | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/profile/saveOrUpdateSchoolDetails/` | Profile | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/profile/saveOrUpdateUniversityDetails/` | Profile | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `GET` | `/v2/profile/sendAccountDeactivationOtp/` | Profile | OFF-LIVE (OTP): sends a real OTP by SMS/email to a real recipient |
| `GET` | `/v2/profile/sendPrimaryDeviceOtp/` | Profile | OFF-LIVE (OTP): sends a real OTP by SMS/email to a real recipient |
| `GET` | `/v2/profile/sendPrimaryOrSecondaryDeviceOtp/{requestType}` | Profile | OFF-LIVE (OTP): sends a real OTP by SMS/email to a real recipient |
| `POST` | `/v2/profile/setDeviceAsPrimary/` | Profile | OFF-LIVE (OTP): needs an OTP validated in an earlier step; live has no bypass |
| `POST` | `/v2/profile/setDeviceAsSecondary` | Profile | OFF-LIVE (OTP): needs an OTP validated in an earlier step; live has no bypass |
| `POST` | `/v2/profile/shareUserDetails` | Profile | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/profile/updateAboutYourself/` | Profile | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/profile/updateBasicInformation/` | Profile | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/profile/updateContactInformation/` | Profile | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/profile/updateDesignation` | Profile | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/profile/updateDeviceAsPrimary/` | Profile | OFF-LIVE (OTP): needs an OTP validated in an earlier step; live has no bypass |
| `POST` | `/v2/profile/updateDeviceAsSecondary` | Profile | OFF-LIVE (OTP): needs an OTP validated in an earlier step; live has no bypass |
| `POST` | `/v2/profile/updatePrivacySettingDetails/` | Profile | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/profile/updateProfileImage/` | Profile | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/profile/updateSignatureImage` | Profile | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/profile/uploadCoverImage/` | Profile | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/profile/uploadImageToS3` | Profile | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/v2/profile/uploadProfileAttachments` | Profile | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/generalSetting/changeTheme` | Settings | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/generalSetting/fontSetting` | Settings | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/generalSetting/kallNotification` | Settings | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/generalSetting/katchupNotification` | Settings | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/generalSetting/kmailNotification` | Settings | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/kmail5/v2/kmailSetting/deleteCustomizedInstantReply` | Settings | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/kmail5/v2/kmailSetting/deleteCustomizedSaluation` | Settings | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/kmail5/v2/kmailSetting/deleteLetterHead` | Settings | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/kmail5/v2/kmailSetting/saveOrUpdateCustomizedInstantReply` | Settings | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/kmail5/v2/kmailSetting/saveOrUpdateCustomizedSaluations` | Settings | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/kmail5/v2/kmailSetting/saveOrUpdateMailSignature` | Settings | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/kmail5/v2/kmailSetting/saveOrUpdateMailSignatureCompanyData` | Settings | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/kmail5/v2/kmailSetting/saveOrUpdateMailSignatureGraphics` | Settings | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/kmail5/v2/kmailSetting/saveOrUpdateMailSignaturePersonalData` | Settings | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/kmail5/v2/kmailSetting/saveOrUpdateMailSignatureSocialMediaLink` | Settings | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/kmail5/v2/kmailSetting/saveOrUpdateMailSignatureStyle` | Settings | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/kmail5/v2/kmailSetting/saveOrUpdateMailSignatureTemplateId` | Settings | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/kmail5/v2/kmailSetting/setLetterHead` | Settings | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |
| `POST` | `/kmail5/v2/kmailSetting/updateMailCountDaysLimit` | Settings | COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning |

---

## What unblocks the rest

**A business account on live** unblocks the company lookups and the business-tier login.
They are blocked today because `QA_COMPANY_ID`, `QA_UNIQUE_NAME` and the business ids are
deliberately unset: an unset identifier is absent from the QA-identifier guard’s allowlist,
so anything naming a company is refused. That is the scope enforcing itself rather than
depending on anyone remembering.

**Nothing unblocks the OTP endpoints.** Live has no bypass, and it must not have one — a
fixed OTP that always validates is an account-takeover key. They stay blocked permanently.

**The destructive endpoints stay blocked by choice**, not by limitation: `updateFlutterAppVersion`
changes what every mobile client is told to install, `saveEnquiryDetails` writes into a real
sales table, and the logo trio acts on a company id taken from the payload rather than the
token. Running them needs a decision, not a flag.

Identity values still unset: QA_ADMIN_KPOST_ID, QA_BUSINESS_RECEIVER_KPOST_ID, QA_FORGOT_PASSWORD_KPOST_ID, QA_OTP_MOBILE, QA_OTP_EMAIL, QA_COMPANY_ID, QA_COMPANY_NAME, QA_UNIQUE_NAME.

