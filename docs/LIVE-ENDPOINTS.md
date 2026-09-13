# Live endpoints — what we can and cannot test

**GENERATED — do not edit.** Written by `tests/framework/live-coverage.spec.ts`
(`npm run test:framework`). Edit the endpoint definitions, not this file.

Target: the live application (`devapi2.kpostindia.com`). Scope: **PERSONAL** accounts only —
no business account exists on live yet.

| | Count |
| - | ----: |
| **Runs on live** | **101** |
| Blocked | 185 |
| Total registered | 286 |

---

## Runs on live — 101

Every one is read-only, needs no company, and uses identifiers that are set in `.env`.
Reaching this list requires `productionSafe: true` on the definition, which is a claim a
reviewer can check against the comment beside it.

| Method | Path | Module |
| ------ | ---- | ------ |
| `POST` | `/v2/aws/checkAttachmentS3/` | AWS |
| `POST` | `/v2/aws/generate-presigned-url` | AWS |
| `GET` | `/v2/common/countries` | common |
| `POST` | `/v2/common/domain/` | common |
| `POST` | `/v2/common/getCitiesByRegionId/` | common |
| `POST` | `/v2/common/getDesignation/` | common |
| `GET` | `/v2/common/getFlutterAppVersion/` | common |
| `POST` | `/v2/common/getKpostIdUsingModule` | common |
| `GET` | `/v2/common/getStates/` | common |
| `POST` | `/v2/common/getTotalCountByDate` | common |
| `POST` | `/v2/common/getUserDetailsByMobNo` | common |
| `POST` | `/v2/common/languages` | common |
| `POST` | `/v2/common/mobileNoExist/` | common |
| `GET` | `/v2/common/msStatus/` | common |
| `POST` | `/v2/common/pinCode` | common |
| `POST` | `/v2/common/postalPinCode/` | common |
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

## Blocked on live — 185

Not failures — these are refused before a request is sent, each for a stated reason.

| Method | Path | Module | Why |
| ------ | ---- | ------ | --- |
| `GET` | `/v2/aws/deleteAttachmentFromS3/{uuid}` | AWS | writes or deletes on the live application |
| `POST` | `/v2/common/forgotPasswordOTPOrSentKpostIDSms` | common | OTP — sends a real OTP by SMS/email to a real recipient |
| `POST` | `/v2/common/forgotPasswordUpdate` | common | OTP — needs an OTP validated in an earlier step; live has no bypass |
| `POST` | `/v2/common/generateDomainAndUniqueName` | common | not cleared: needs a business account or company we do not have on live yet |
| `POST` | `/v2/common/mobileNoExistInsideCompany/` | common | not cleared: needs a business account or company we do not have on live yet |
| `POST` | `/v2/common/saveEnquiryDetails` | common | writes or deletes on the live application |
| `POST` | `/v2/common/saveUnsubscriberDetails` | common | writes or deletes on the live application |
| `POST` | `/v2/common/sendOTP/` | common | OTP — sends a real OTP by SMS/email to a real recipient |
| `POST` | `/v2/common/sendOTPtoMail/` | common | OTP — sends a real OTP by SMS/email to a real recipient |
| `POST` | `/v2/common/uniqueNameExist` | common | not cleared: needs a business account or company we do not have on live yet |
| `POST` | `/v2/common/updateFlutterAppVersion` | common | writes state shared by other users of the live application |
| `POST` | `/v2/common/validateMailOTP/` | common | OTP — needs a real OTP in its payload; live has no bypass |
| `POST` | `/v2/common/validateOTP/` | common | OTP — needs a real OTP in its payload; live has no bypass |
| `POST` | `/admin/removeCompanyLogo` | common · company | writes state shared by other users of the live application |
| `GET` | `/v2/common/downloadCompanyLogo/{companyID}` | common · company | not cleared: needs a business account or company we do not have on live yet |
| `POST` | `/v2/common/getCompanyDetails` | common · company | not cleared: needs a business account or company we do not have on live yet |
| `POST` | `/v2/common/getCompanyDetailsByAdmin` | common · company | not cleared: needs a business account or company we do not have on live yet |
| `POST` | `/v2/common/getCompanyDetailsByMobileNoAndproductId` | common · company | not cleared: needs a business account or company we do not have on live yet |
| `GET` | `/v2/common/getCompanyNameExistOnKpostAndKsmacc/{companyName}` | common · company | not cleared: needs a business account or company we do not have on live yet |
| `POST` | `/v2/common/updateCompanyLogo` | common · company | writes state shared by other users of the live application |
| `POST` | `/v2/contacts/addContact` | Contacts | writes or deletes on the live application |
| `POST` | `/v2/contacts/addContactReference/` | Contacts | writes or deletes on the live application |
| `POST` | `/v2/contacts/addMultipleContact` | Contacts | writes or deletes on the live application |
| `POST` | `/v2/contacts/blockOrUnBlockContact/` | Contacts | writes or deletes on the live application |
| `POST` | `/v2/contacts/blockOrUnBlockMultipleContact` | Contacts | writes or deletes on the live application |
| `POST` | `/v2/contacts/deleteContact/` | Contacts | writes or deletes on the live application |
| `POST` | `/v2/contacts/importPhoneContacts/` | Contacts | writes or deletes on the live application |
| `POST` | `/v2/contacts/updateInviteStatus/` | Contacts | writes or deletes on the live application |
| `POST` | `/v2/group/addOrRemoveAdminAccess/` | Group | writes or deletes on the live application |
| `POST` | `/v2/group/addUserToGroup/` | Group | writes or deletes on the live application |
| `POST` | `/v2/group/createUserGroup/` | Group | writes or deletes on the live application |
| `POST` | `/v2/group/deleteGroup` | Group | writes or deletes on the live application |
| `GET` | `/v2/group/downloadGroupFullProfileImage/{groupKpostID}/{kpostID}` | Group | needs a real message/call/group id that only a write flow creates |
| `GET` | `/v2/group/downloadGroupProfileImage/{groupKpostID}/{kpostID}` | Group | needs a real message/call/group id that only a write flow creates |
| `POST` | `/v2/group/editGroupName` | Group | writes or deletes on the live application |
| `POST` | `/v2/group/leaveFromGroup/` | Group | writes or deletes on the live application |
| `POST` | `/v2/group/removeGroupMember/` | Group | writes or deletes on the live application |
| `POST` | `/v2/group/removeGroupProfileImage` | Group | writes or deletes on the live application |
| `POST` | `/v2/group/updateGroupProfileImage/` | Group | writes or deletes on the live application |
| `POST` | `/v2/kall/clearKallBykallIds` | Kall | writes or deletes on the live application |
| `GET` | `/v2/kall/clearKallHistory` | Kall | writes or deletes on the live application |
| `POST` | `/v2/kall/endIndividualKall/` | Kall | writes or deletes on the live application |
| `POST` | `/v2/kall/endKoolKall` | Kall | writes or deletes on the live application |
| `POST` | `/v2/kall/getKallStatus` | Kall | needs a real message/call/group id that only a write flow creates |
| `POST` | `/v2/kall/getKallStatusUsingKallID` | Kall | needs a real message/call/group id that only a write flow creates |
| `POST` | `/v2/kall/initiateKall` | Kall | writes or deletes on the live application |
| `POST` | `/v2/kall/joinScheduleKall` | Kall | writes or deletes on the live application |
| `POST` | `/v2/kall/modifyKallMembers` | Kall | writes or deletes on the live application |
| `POST` | `/v2/kall/reScheduleKall` | Kall | writes or deletes on the live application |
| `POST` | `/v2/kall/scheduledKall` | Kall | writes or deletes on the live application |
| `POST` | `/v2/kall/scheduledRepeatKall` | Kall | writes or deletes on the live application |
| `POST` | `/v2/kall/updateKallStatus` | Kall | writes or deletes on the live application |
| `POST` | `/v2/kall/updateSenderAndReceiverKallStatus` | Kall | writes or deletes on the live application |
| `POST` | `/v2/katchup/deleteKatchUpMessage/` | Katchup | writes or deletes on the live application |
| `GET` | `/v2/katchup/download/{uuid}` | Katchup | needs a real message/call/group id that only a write flow creates |
| `GET` | `/v2/katchup/downloadAttachment/{uuid}` | Katchup | needs a real message/call/group id that only a write flow creates |
| `GET` | `/v2/katchup/downloadFromS3/{uuid}` | Katchup | needs a real message/call/group id that only a write flow creates |
| `GET` | `/v2/katchup/downloadThumbnail/{uuid}` | Katchup | needs a real message/call/group id that only a write flow creates |
| `POST` | `/v2/katchup/forwardKatchupMessage/` | Katchup | writes or deletes on the live application |
| `POST` | `/v2/katchup/forwardKatchupMessageNew` | Katchup | writes or deletes on the live application |
| `POST` | `/v2/katchup/forwardKatchupMultipleMsgs` | Katchup | writes or deletes on the live application |
| `POST` | `/v2/katchup/forwardMessageBacktrackByMsgID` | Katchup | needs a real message/call/group id that only a write flow creates |
| `POST` | `/v2/katchup/generateThumbnailUsingUUID` | Katchup | writes or deletes on the live application |
| `POST` | `/v2/katchup/getBulkMessageInfo/` | Katchup | needs a real message/call/group id that only a write flow creates |
| `POST` | `/v2/katchup/getMessagesByReferenceMessageList` | Katchup | needs a real message/call/group id that only a write flow creates |
| `POST` | `/v2/katchup/getReadStatusGroupMessage/` | Katchup | needs a real message/call/group id that only a write flow creates |
| `POST` | `/v2/katchup/getReferenceMSGDetails/` | Katchup | needs a real message/call/group id that only a write flow creates |
| `GET` | `/v2/katchup/getSharedMessageDetails/{msgID}` | Katchup | needs a real message/call/group id that only a write flow creates |
| `POST` | `/v2/katchup/getSharedMessageInfo/` | Katchup | needs a real message/call/group id that only a write flow creates |
| `POST` | `/v2/katchup/markOrUnmarkImportantMessage/` | Katchup | writes or deletes on the live application |
| `GET` | `/v2/katchup/mediaStreaming/{uuid}` | Katchup | needs a real message/call/group id that only a write flow creates |
| `POST` | `/v2/katchup/recallMessage/` | Katchup | writes or deletes on the live application |
| `POST` | `/v2/katchup/reportAbuse` | Katchup | writes or deletes on the live application |
| `POST` | `/v2/katchup/saveKatchupMessages/` | Katchup | writes or deletes on the live application |
| `POST` | `/v2/katchup/sendBulkKatchupMsg` | Katchup | writes or deletes on the live application |
| `POST` | `/v2/katchup/sendBulkKatchupMsgMultiPart/` | Katchup | writes or deletes on the live application |
| `POST` | `/v2/katchup/sendKatchupMsgMultiPart/` | Katchup | writes or deletes on the live application |
| `POST` | `/v2/katchup/sendMessage/` | Katchup | writes or deletes on the live application |
| `POST` | `/v2/katchup/sendMessageForForwardSelectedAttachment` | Katchup | writes or deletes on the live application |
| `POST` | `/dairySchedule/addparticipants` | KDiary | writes or deletes on the live application |
| `POST` | `/dairySchedule/createEvent` | KDiary | writes or deletes on the live application |
| `POST` | `/dairySchedule/createSchedule` | KDiary | writes or deletes on the live application |
| `POST` | `/dairySchedule/deleteEvent` | KDiary | writes or deletes on the live application |
| `POST` | `/dairySchedule/editReport` | KDiary | writes or deletes on the live application |
| `POST` | `/dairySchedule/editScheduleEvent` | KDiary | writes or deletes on the live application |
| `POST` | `/dairySchedule/saveReport` | KDiary | writes or deletes on the live application |
| `POST` | `/dairySchedule/updateEvent` | KDiary | writes or deletes on the live application |
| `POST` | `/dairySchedule/updateScheduleRemarks` | KDiary | writes or deletes on the live application |
| `POST` | `/kmail5/v2/common/addOtherDomainContacts/` | KMail | writes or deletes on the live application |
| `POST` | `/kmail5/v2/common/clearStatusOfAllKmailsContacts` | KMail | writes or deletes on the live application |
| `POST` | `/kmail5/v2/common/clearStatusOfKmailsContacts/` | KMail | writes or deletes on the live application |
| `POST` | `/kmail5/v2/common/convertMailAsPDF/` | KMail | writes or deletes on the live application |
| `POST` | `/kmail5/v2/common/deleteKmailWithDeletedBy/` | KMail | writes or deletes on the live application |
| `POST` | `/kmail5/v2/common/deleteOtherDomainContact/` | KMail | writes or deletes on the live application |
| `POST` | `/kmail5/v2/common/editOtherDomainContactsDetails/` | KMail | writes or deletes on the live application |
| `POST` | `/kmail5/v2/common/kmailGroupReadStatus/` | KMail | not cleared: needs a business account or company we do not have on live yet |
| `POST` | `/kmail5/v2/common/replyNotRequiredByReceiver/` | KMail | not cleared: needs a business account or company we do not have on live yet |
| `POST` | `/kmail5/v2/common/replyNotRequiredBySender/` | KMail | not cleared: needs a business account or company we do not have on live yet |
| `POST` | `/kmail5/v2/common/setKmailAsImportant/` | KMail | writes or deletes on the live application |
| `POST` | `/kmail5/v2/draft/deleteDraftMail/` | KMail | writes or deletes on the live application |
| `POST` | `/kmail5/v2/draft/draftMail/` | KMail | writes or deletes on the live application |
| `POST` | `/kmail5/v2/draft/draftMailMultiPart` | KMail | writes or deletes on the live application |
| `GET` | `/kmail5/v2/readMail/download/{uuid}` | KMail | not cleared: needs a business account or company we do not have on live yet |
| `POST` | `/kmail5/v2/readMail/downloadODAttachment` | KMail | writes or deletes on the live application |
| `GET` | `/kmail5/v2/readMail/downloadThumbnail/{uuid}` | KMail | not cleared: needs a business account or company we do not have on live yet |
| `POST` | `/kmail5/v2/readMail/draftMailContent` | KMail | not cleared: needs a business account or company we do not have on live yet |
| `GET` | `/kmail5/v2/readMail/getCopiesInfo/{kmailID}` | KMail | not cleared: needs a business account or company we do not have on live yet |
| `POST` | `/kmail5/v2/readMail/getKmailDetailsUsingKmailID` | KMail | not cleared: needs a business account or company we do not have on live yet |
| `GET` | `/kmail5/v2/readMail/mediaStreaming/{uuid}` | KMail | not cleared: needs a business account or company we do not have on live yet |
| `POST` | `/kmail5/v2/readMail/sentAndInboxMailContent/` | KMail | not cleared: needs a business account or company we do not have on live yet |
| `GET` | `/kmail5/v2/sentMail/bulkMail/status/{fromAddress}` | KMail | not cleared: needs a business account or company we do not have on live yet |
| `POST` | `/kmail5/v2/sentMail/getMailCredentials/` | KMail | writes state shared by other users of the live application |
| `POST` | `/kmail5/v2/sentMail/postBulkMail` | KMail | writes or deletes on the live application |
| `POST` | `/kmail5/v2/sentMail/postMail/` | KMail | writes or deletes on the live application |
| `POST` | `/ai/chatResponse` | KOS | writes or deletes on the live application |
| `POST` | `/ai/messageAssist` | KOS | writes or deletes on the live application |
| `GET` | `/ai/messages/{sessionId}` | KOS | not cleared: needs a business account or company we do not have on live yet |
| `POST` | `/kword/create` | KOS | writes or deletes on the live application |
| `GET` | `/kword/delete` | KOS | writes or deletes on the live application |
| `POST` | `/kword/deleteHeading` | KOS | writes or deletes on the live application |
| `GET` | `/kword/documents/{docId}` | KOS | not cleared: needs a business account or company we do not have on live yet |
| `GET` | `/kword/exitDocument/{docId}` | KOS | writes or deletes on the live application |
| `GET` | `/kword/getAccessActivity/{docId}` | KOS | not cleared: needs a business account or company we do not have on live yet |
| `GET` | `/kword/getAllRevision/{docId}` | KOS | not cleared: needs a business account or company we do not have on live yet |
| `POST` | `/kword/isConvertToKad` | KOS | writes or deletes on the live application |
| `POST` | `/kword/joinDocument` | KOS | writes or deletes on the live application |
| `GET` | `/kword/presence/{docId}` | KOS | not cleared: needs a business account or company we do not have on live yet |
| `POST` | `/kword/saveContent` | KOS | writes or deletes on the live application |
| `POST` | `/kword/share` | KOS | writes or deletes on the live application |
| `POST` | `/kword/update` | KOS | writes or deletes on the live application |
| `POST` | `/signupLoginForMediumAndLarge/adminUserLogin` | Login & session | not cleared: needs a business account or company we do not have on live yet |
| `POST` | `/v2/signupLogin/setAccessCode` | Login & session | writes state shared by other users of the live application |
| `GET` | `/v2/signupLogin/userLogoutFromAllDevices/` | Login & session | writes state shared by other users of the live application |
| `POST` | `/v2/profile/changePassword` | Profile | writes state shared by other users of the live application |
| `POST` | `/v2/profile/convertBase64ToImage` | Profile | writes or deletes on the live application |
| `POST` | `/v2/profile/deactivateAccount/` | Profile | OTP — needs an OTP validated in an earlier step; live has no bypass |
| `POST` | `/v2/profile/deleteCollegeDetail` | Profile | writes or deletes on the live application |
| `POST` | `/v2/profile/deleteExperienceDetail` | Profile | writes or deletes on the live application |
| `POST` | `/v2/profile/deleteSchoolDetail` | Profile | writes or deletes on the live application |
| `POST` | `/v2/profile/deleteUniversityDetail` | Profile | writes or deletes on the live application |
| `POST` | `/v2/profile/forgotPasswordOrKpostID/` | Profile | OTP — sends a real OTP by SMS/email to a real recipient |
| `GET` | `/v2/profile/removeCoverImage/` | Profile | writes or deletes on the live application |
| `GET` | `/v2/profile/removeProfileImage/` | Profile | writes or deletes on the live application |
| `POST` | `/v2/profile/saveOrUpdateCollegeDetails/` | Profile | writes or deletes on the live application |
| `POST` | `/v2/profile/saveOrUpdateExperienceDetails/` | Profile | writes or deletes on the live application |
| `POST` | `/v2/profile/saveOrUpdateOtherActivity/` | Profile | writes or deletes on the live application |
| `POST` | `/v2/profile/saveOrUpdateSchoolDetails/` | Profile | writes or deletes on the live application |
| `POST` | `/v2/profile/saveOrUpdateUniversityDetails/` | Profile | writes or deletes on the live application |
| `GET` | `/v2/profile/sendAccountDeactivationOtp/` | Profile | OTP — sends a real OTP by SMS/email to a real recipient |
| `GET` | `/v2/profile/sendPrimaryDeviceOtp/` | Profile | OTP — sends a real OTP by SMS/email to a real recipient |
| `GET` | `/v2/profile/sendPrimaryOrSecondaryDeviceOtp/{requestType}` | Profile | OTP — sends a real OTP by SMS/email to a real recipient |
| `POST` | `/v2/profile/setDeviceAsPrimary/` | Profile | OTP — needs an OTP validated in an earlier step; live has no bypass |
| `POST` | `/v2/profile/setDeviceAsSecondary` | Profile | OTP — needs an OTP validated in an earlier step; live has no bypass |
| `POST` | `/v2/profile/shareUserDetails` | Profile | writes or deletes on the live application |
| `POST` | `/v2/profile/updateAboutYourself/` | Profile | writes or deletes on the live application |
| `POST` | `/v2/profile/updateBasicInformation/` | Profile | writes or deletes on the live application |
| `POST` | `/v2/profile/updateContactInformation/` | Profile | writes or deletes on the live application |
| `POST` | `/v2/profile/updateDesignation` | Profile | writes or deletes on the live application |
| `POST` | `/v2/profile/updateDeviceAsPrimary/` | Profile | OTP — needs an OTP validated in an earlier step; live has no bypass |
| `POST` | `/v2/profile/updateDeviceAsSecondary` | Profile | OTP — needs an OTP validated in an earlier step; live has no bypass |
| `POST` | `/v2/profile/updatePrivacySettingDetails/` | Profile | writes or deletes on the live application |
| `POST` | `/v2/profile/updateProfileImage/` | Profile | writes or deletes on the live application |
| `POST` | `/v2/profile/updateSignatureImage` | Profile | writes or deletes on the live application |
| `POST` | `/v2/profile/uploadCoverImage/` | Profile | writes or deletes on the live application |
| `POST` | `/v2/profile/uploadImageToS3` | Profile | writes or deletes on the live application |
| `POST` | `/v2/profile/uploadProfileAttachments` | Profile | writes or deletes on the live application |
| `POST` | `/generalSetting/changeTheme` | Settings | writes or deletes on the live application |
| `POST` | `/generalSetting/fontSetting` | Settings | writes or deletes on the live application |
| `POST` | `/generalSetting/kallNotification` | Settings | writes or deletes on the live application |
| `POST` | `/generalSetting/katchupNotification` | Settings | writes or deletes on the live application |
| `POST` | `/generalSetting/kmailNotification` | Settings | writes or deletes on the live application |
| `POST` | `/kmail5/v2/kmailSetting/deleteCustomizedInstantReply` | Settings | writes or deletes on the live application |
| `POST` | `/kmail5/v2/kmailSetting/deleteCustomizedSaluation` | Settings | writes or deletes on the live application |
| `POST` | `/kmail5/v2/kmailSetting/deleteLetterHead` | Settings | writes or deletes on the live application |
| `POST` | `/kmail5/v2/kmailSetting/saveOrUpdateCustomizedInstantReply` | Settings | writes or deletes on the live application |
| `POST` | `/kmail5/v2/kmailSetting/saveOrUpdateCustomizedSaluations` | Settings | writes or deletes on the live application |
| `POST` | `/kmail5/v2/kmailSetting/saveOrUpdateMailSignature` | Settings | writes or deletes on the live application |
| `POST` | `/kmail5/v2/kmailSetting/saveOrUpdateMailSignatureCompanyData` | Settings | writes or deletes on the live application |
| `POST` | `/kmail5/v2/kmailSetting/saveOrUpdateMailSignatureGraphics` | Settings | writes or deletes on the live application |
| `POST` | `/kmail5/v2/kmailSetting/saveOrUpdateMailSignaturePersonalData` | Settings | writes or deletes on the live application |
| `POST` | `/kmail5/v2/kmailSetting/saveOrUpdateMailSignatureSocialMediaLink` | Settings | writes or deletes on the live application |
| `POST` | `/kmail5/v2/kmailSetting/saveOrUpdateMailSignatureStyle` | Settings | writes or deletes on the live application |
| `POST` | `/kmail5/v2/kmailSetting/saveOrUpdateMailSignatureTemplateId` | Settings | writes or deletes on the live application |
| `POST` | `/kmail5/v2/kmailSetting/setLetterHead` | Settings | writes or deletes on the live application |
| `POST` | `/kmail5/v2/kmailSetting/updateMailCountDaysLimit` | Settings | writes or deletes on the live application |

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

Identity values still unset: QA_ADMIN_KPOST_ID, QA_BUSINESS_S_KPOST_ID, QA_BUSINESS_M_KPOST_ID, QA_BUSINESS_L_KPOST_ID, QA_BUSINESS_RECEIVER_KPOST_ID, QA_FORGOT_PASSWORD_KPOST_ID, QA_OTP_MOBILE, QA_OTP_EMAIL, QA_COMPANY_ID, QA_COMPANY_NAME, QA_UNIQUE_NAME.

