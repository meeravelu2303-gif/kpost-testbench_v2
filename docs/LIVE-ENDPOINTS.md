# Live endpoints — what we can and cannot test

**GENERATED — do not edit.** Written by `tests/framework/live-coverage.spec.ts`
(`npm run test:framework`). Edit the endpoint definitions, not this file.

Target: the live application (`devapi2.kpostindia.com`). Scope: **PERSONAL** accounts only —
no business account exists on live yet.

|                  |  Count |
| ---------------- | -----: |
| **Runs on live** | **30** |
| Blocked          |     59 |
| Total registered |     89 |

---

## Runs on live — 30

Every one is read-only, needs no company, and uses identifiers that are set in `.env`.
Reaching this list requires `productionSafe: true` on the definition, which is a claim a
reviewer can check against the comment beside it.

| Method | Path                                                  | Module          |
| ------ | ----------------------------------------------------- | --------------- |
| `GET`  | `/v2/common/countries`                                | common          |
| `POST` | `/v2/common/domain/`                                  | common          |
| `POST` | `/v2/common/getCitiesByRegionId/`                     | common          |
| `POST` | `/v2/common/getDesignation/`                          | common          |
| `GET`  | `/v2/common/getFlutterAppVersion/`                    | common          |
| `POST` | `/v2/common/getKpostIdUsingModule`                    | common          |
| `GET`  | `/v2/common/getStates/`                               | common          |
| `POST` | `/v2/common/getTotalCountByDate`                      | common          |
| `POST` | `/v2/common/getUserDetailsByMobNo`                    | common          |
| `POST` | `/v2/common/languages`                                | common          |
| `POST` | `/v2/common/mobileNoExist/`                           | common          |
| `GET`  | `/v2/common/msStatus/`                                | common          |
| `POST` | `/v2/common/pinCode`                                  | common          |
| `POST` | `/v2/common/postalPinCode/`                           | common          |
| `POST` | `/v2/katchup/filterKatchUpMessage/`                   | Katchup         |
| `GET`  | `/v2/katchup/frequentlyAccessContacts`                | Katchup         |
| `GET`  | `/v2/katchup/getAllReportMsg`                         | Katchup         |
| `GET`  | `/v2/katchup/getKatchupMessagesSubject`               | Katchup         |
| `GET`  | `/v2/katchup/getUnopenedMessagesAndKmailsTotalCount/` | Katchup         |
| `GET`  | `/v2/katchup/getUnopenedMessagesCount/`               | Katchup         |
| `POST` | `/v2/katchup/katchupMessagesForSelectedContactID/`    | Katchup         |
| `POST` | `/v2/katchup/messageCountBetweenSenderAndReceiver/`   | Katchup         |
| `POST` | `/v2/katchup/searchKatchUpMessage/`                   | Katchup         |
| `POST` | `/v2/katchup/searchKatchUpMessageSubject`             | Katchup         |
| `POST` | `/v2/signupLogin/fetchUserDetails/`                   | Login & session |
| `POST` | `/v2/signupLogin/generateJWTokens/`                   | Login & session |
| `GET`  | `/v2/signupLogin/getActiveSession`                    | Login & session |
| `POST` | `/v2/signupLogin/getLoginHistory`                     | Login & session |
| `POST` | `/v2/signupLogin/userLogin/`                          | Login & session |
| `POST` | `/v2/signupLogin/userLogout/`                         | Login & session |

---

## Blocked on live — 59

Not failures — these are refused before a request is sent, each for a stated reason.

| Method | Path                                                               | Module           | Why                                                                         |
| ------ | ------------------------------------------------------------------ | ---------------- | --------------------------------------------------------------------------- |
| `POST` | `/v2/common/forgotPasswordOTPOrSentKpostIDSms`                     | common           | OTP — sends a real OTP by SMS/email to a real recipient                     |
| `POST` | `/v2/common/forgotPasswordUpdate`                                  | common           | OTP — needs an OTP validated in an earlier step; live has no bypass         |
| `POST` | `/v2/common/generateDomainAndUniqueName`                           | common           | not cleared: needs a business account or company we do not have on live yet |
| `POST` | `/v2/common/mobileNoExistInsideCompany/`                           | common           | not cleared: needs a business account or company we do not have on live yet |
| `POST` | `/v2/common/saveEnquiryDetails`                                    | common           | writes or deletes on the live application                                   |
| `POST` | `/v2/common/saveUnsubscriberDetails`                               | common           | writes or deletes on the live application                                   |
| `POST` | `/v2/common/sendOTP/`                                              | common           | OTP — sends a real OTP by SMS/email to a real recipient                     |
| `POST` | `/v2/common/sendOTPtoMail/`                                        | common           | OTP — sends a real OTP by SMS/email to a real recipient                     |
| `POST` | `/v2/common/uniqueNameExist`                                       | common           | not cleared: needs a business account or company we do not have on live yet |
| `POST` | `/v2/common/updateFlutterAppVersion`                               | common           | writes state shared by other users of the live application                  |
| `POST` | `/v2/common/validateMailOTP/`                                      | common           | OTP — needs a real OTP in its payload; live has no bypass                   |
| `POST` | `/v2/common/validateOTP/`                                          | common           | OTP — needs a real OTP in its payload; live has no bypass                   |
| `POST` | `/admin/removeCompanyLogo`                                         | common · company | writes state shared by other users of the live application                  |
| `GET`  | `/v2/common/downloadCompanyLogo/{companyID}`                       | common · company | not cleared: needs a business account or company we do not have on live yet |
| `POST` | `/v2/common/getCompanyDetails`                                     | common · company | not cleared: needs a business account or company we do not have on live yet |
| `POST` | `/v2/common/getCompanyDetailsByAdmin`                              | common · company | not cleared: needs a business account or company we do not have on live yet |
| `POST` | `/v2/common/getCompanyDetailsByMobileNoAndproductId`               | common · company | not cleared: needs a business account or company we do not have on live yet |
| `GET`  | `/v2/common/getCompanyNameExistOnKpostAndKsmacc/{companyName}`     | common · company | not cleared: needs a business account or company we do not have on live yet |
| `POST` | `/v2/common/updateCompanyLogo`                                     | common · company | writes state shared by other users of the live application                  |
| `POST` | `/v2/katchup/deleteKatchUpMessage/`                                | Katchup          | writes or deletes on the live application                                   |
| `GET`  | `/v2/katchup/download/{uuid}`                                      | Katchup          | not cleared: needs a business account or company we do not have on live yet |
| `GET`  | `/v2/katchup/downloadAttachment/{uuid}`                            | Katchup          | not cleared: needs a business account or company we do not have on live yet |
| `GET`  | `/v2/katchup/downloadFromS3/{uuid}`                                | Katchup          | not cleared: needs a business account or company we do not have on live yet |
| `GET`  | `/v2/katchup/downloadThumbnail/{uuid}`                             | Katchup          | not cleared: needs a business account or company we do not have on live yet |
| `POST` | `/v2/katchup/forwardKatchupMessage/`                               | Katchup          | writes or deletes on the live application                                   |
| `POST` | `/v2/katchup/forwardKatchupMessageNew`                             | Katchup          | writes or deletes on the live application                                   |
| `POST` | `/v2/katchup/forwardKatchupMultipleMsgs`                           | Katchup          | writes or deletes on the live application                                   |
| `POST` | `/v2/katchup/forwardMessageBacktrackByMsgID`                       | Katchup          | not cleared: needs a business account or company we do not have on live yet |
| `POST` | `/v2/katchup/generateThumbnailUsingUUID`                           | Katchup          | writes or deletes on the live application                                   |
| `POST` | `/v2/katchup/getBulkMessageInfo/`                                  | Katchup          | not cleared: needs a business account or company we do not have on live yet |
| `POST` | `/v2/katchup/getMessagesByReferenceMessageList`                    | Katchup          | not cleared: needs a business account or company we do not have on live yet |
| `POST` | `/v2/katchup/getReadStatusGroupMessage/`                           | Katchup          | not cleared: needs a business account or company we do not have on live yet |
| `POST` | `/v2/katchup/getReferenceMSGDetails/`                              | Katchup          | not cleared: needs a business account or company we do not have on live yet |
| `GET`  | `/v2/katchup/getSharedMessageDetails/{msgID}`                      | Katchup          | not cleared: needs a business account or company we do not have on live yet |
| `POST` | `/v2/katchup/getSharedMessageInfo/`                                | Katchup          | not cleared: needs a business account or company we do not have on live yet |
| `POST` | `/v2/katchup/markOrUnmarkImportantMessage/`                        | Katchup          | writes or deletes on the live application                                   |
| `GET`  | `/v2/katchup/mediaStreaming/{uuid}`                                | Katchup          | not cleared: needs a business account or company we do not have on live yet |
| `POST` | `/v2/katchup/recallMessage/`                                       | Katchup          | writes or deletes on the live application                                   |
| `POST` | `/v2/katchup/reportAbuse`                                          | Katchup          | writes or deletes on the live application                                   |
| `POST` | `/v2/katchup/saveKatchupMessages/`                                 | Katchup          | writes or deletes on the live application                                   |
| `POST` | `/v2/katchup/sendBulkKatchupMsg`                                   | Katchup          | writes or deletes on the live application                                   |
| `POST` | `/v2/katchup/sendBulkKatchupMsgMultiPart/`                         | Katchup          | writes or deletes on the live application                                   |
| `POST` | `/v2/katchup/sendKatchupMsgMultiPart/`                             | Katchup          | writes or deletes on the live application                                   |
| `POST` | `/v2/katchup/sendMessage/`                                         | Katchup          | writes or deletes on the live application                                   |
| `POST` | `/v2/katchup/sendMessageForForwardSelectedAttachment`              | Katchup          | writes or deletes on the live application                                   |
| `POST` | `/signupLoginForMediumAndLarge/adminUserLogin`                     | Login & session  | not cleared: needs a business account or company we do not have on live yet |
| `POST` | `/v2/signupLogin/setAccessCode`                                    | Login & session  | writes state shared by other users of the live application                  |
| `GET`  | `/v2/signupLogin/userLogoutFromAllDevices/`                        | Login & session  | writes state shared by other users of the live application                  |
| `POST` | `/v2/group/addOrRemoveAdminAccess/`                                | other            | writes or deletes on the live application                                   |
| `POST` | `/v2/group/addUserToGroup/`                                        | other            | writes or deletes on the live application                                   |
| `POST` | `/v2/group/createUserGroup/`                                       | other            | writes or deletes on the live application                                   |
| `POST` | `/v2/group/deleteGroup`                                            | other            | writes or deletes on the live application                                   |
| `GET`  | `/v2/group/downloadGroupFullProfileImage/{groupKpostID}/{kpostID}` | other            | not cleared: needs a business account or company we do not have on live yet |
| `GET`  | `/v2/group/downloadGroupProfileImage/{groupKpostID}/{kpostID}`     | other            | not cleared: needs a business account or company we do not have on live yet |
| `POST` | `/v2/group/editGroupName`                                          | other            | writes or deletes on the live application                                   |
| `POST` | `/v2/group/leaveFromGroup/`                                        | other            | writes or deletes on the live application                                   |
| `POST` | `/v2/group/removeGroupMember/`                                     | other            | writes or deletes on the live application                                   |
| `POST` | `/v2/group/removeGroupProfileImage`                                | other            | writes or deletes on the live application                                   |
| `POST` | `/v2/group/updateGroupProfileImage/`                               | other            | writes or deletes on the live application                                   |

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
