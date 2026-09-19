# Endpoints NOT tested on the live application

**GENERATED — do not edit.** Written by `tests/framework/live-coverage.spec.ts`.

**47 of 341** registered endpoints are **not driven against the live app**.
The rest ARE tested on live: **121** on the default run + **173** via the
gated self-cleaning lifecycle flows (`npm run kpost:file`). This file lists ONLY the not-tested.

They are not silent gaps — each is refused for a permanent constraint or a deliberate safety
choice, and every one is still contract-validated OFF live.

## Count by category

| Category | Count |
| -------- | ----: |
| OTP — no bypass on live (permanent) | 17 |
| Shared / global write (by choice) | 15 |
| Attachment file-upload — the one REAL coverage gap | 7 |
| Needs setup we lack (business login 403, company logo 500) | 6 |
| Public record write (enquiry / unsubscribe) | 2 |
| **Total not tested on live** | **47** |

---

## The endpoints, module by module

### common · company (11)

| Method | Path | Why not tested on live |
| ------ | ---- | ---------------------- |
| `POST` | `/admin/addingUserByAdmin/` | writes state shared by the whole environment (no self-cleaning lifecycle) |
| `POST` | `/admin/createOrRemoveBackupAdmin/` | writes state shared by the whole environment (no self-cleaning lifecycle) |
| `POST` | `/admin/holdOrRelease/` | writes state shared by the whole environment (no self-cleaning lifecycle) |
| `POST` | `/admin/removeCompanyLogo` | writes state shared by the whole environment (no self-cleaning lifecycle) |
| `POST` | `/admin/resetPassword/` | writes state shared by the whole environment (no self-cleaning lifecycle) |
| `POST` | `/admin/terminateUser/` | writes state shared by the whole environment (no self-cleaning lifecycle) |
| `POST` | `/v2/admin/updateBankAccountDetails` | writes state shared by the whole environment (no self-cleaning lifecycle) |
| `POST` | `/v2/admin/updateCompanyDetails` | writes state shared by the whole environment (no self-cleaning lifecycle) |
| `POST` | `/v2/admin/updateRole` | writes state shared by the whole environment (no self-cleaning lifecycle) |
| `GET` | `/v2/common/downloadCompanyLogo/{companyID}` | read needs setup we do not have (business-tier login answers 403; company logo 500s) |
| `POST` | `/v2/common/updateCompanyLogo` | writes state shared by the whole environment (no self-cleaning lifecycle) |

### Profile (10)

| Method | Path | Why not tested on live |
| ------ | ---- | ---------------------- |
| `POST` | `/v2/profile/changePassword` | writes state shared by the whole environment (no self-cleaning lifecycle) |
| `POST` | `/v2/profile/deactivateAccount/` | needs an OTP validated in an earlier step; live has no bypass |
| `POST` | `/v2/profile/forgotPasswordOrKpostID/` | sends a real OTP by SMS/email to a real recipient |
| `GET` | `/v2/profile/sendAccountDeactivationOtp/` | sends a real OTP by SMS/email to a real recipient |
| `GET` | `/v2/profile/sendPrimaryDeviceOtp/` | sends a real OTP by SMS/email to a real recipient |
| `GET` | `/v2/profile/sendPrimaryOrSecondaryDeviceOtp/{requestType}` | sends a real OTP by SMS/email to a real recipient |
| `POST` | `/v2/profile/setDeviceAsPrimary/` | needs an OTP validated in an earlier step; live has no bypass |
| `POST` | `/v2/profile/setDeviceAsSecondary` | needs an OTP validated in an earlier step; live has no bypass |
| `POST` | `/v2/profile/updateDeviceAsPrimary/` | needs an OTP validated in an earlier step; live has no bypass |
| `POST` | `/v2/profile/updateDeviceAsSecondary` | needs an OTP validated in an earlier step; live has no bypass |

### common (9)

| Method | Path | Why not tested on live |
| ------ | ---- | ---------------------- |
| `POST` | `/v2/common/forgotPasswordOTPOrSentKpostIDSms` | sends a real OTP by SMS/email to a real recipient |
| `POST` | `/v2/common/forgotPasswordUpdate` | needs an OTP validated in an earlier step; live has no bypass |
| `POST` | `/v2/common/saveEnquiryDetails` | persists a real shared record (enquiry / unsubscribe) — no self-cleaning lifecycle |
| `POST` | `/v2/common/saveUnsubscriberDetails` | persists a real shared record (enquiry / unsubscribe) — no self-cleaning lifecycle |
| `POST` | `/v2/common/sendOTP/` | sends a real OTP by SMS/email to a real recipient |
| `POST` | `/v2/common/sendOTPtoMail/` | sends a real OTP by SMS/email to a real recipient |
| `POST` | `/v2/common/updateFlutterAppVersion` | writes state shared by the whole environment (no self-cleaning lifecycle) |
| `POST` | `/v2/common/validateMailOTP/` | needs a real OTP in its payload; live has no bypass |
| `POST` | `/v2/common/validateOTP/` | needs a real OTP in its payload; live has no bypass |

### KMail (5)

| Method | Path | Why not tested on live |
| ------ | ---- | ---------------------- |
| `POST` | `/testkmail/v2/common/getBulkKmailDashboardMsg` | read needs setup we do not have (business-tier login answers 403; company logo 500s) |
| `GET` | `/testkmail/v2/readMail/download/{uuid}` | needs a real uploaded attachment (S3 file upload) — the one file-upload gap |
| `GET` | `/testkmail/v2/readMail/downloadThumbnail/{uuid}` | needs a real uploaded attachment (S3 file upload) — the one file-upload gap |
| `GET` | `/testkmail/v2/readMail/mediaStreaming/{uuid}` | needs a real uploaded attachment (S3 file upload) — the one file-upload gap |
| `POST` | `/testkmail/v2/sentMail/getMailCredentials/` | writes state shared by the whole environment (no self-cleaning lifecycle) |

### Login & session (5)

| Method | Path | Why not tested on live |
| ------ | ---- | ---------------------- |
| `POST` | `/signupLoginForMediumAndLarge/adminUserLogin` | read needs setup we do not have (business-tier login answers 403; company logo 500s) |
| `POST` | `/v2/signupLogin/adminRegistration/` | needs an OTP validated in an earlier step; live has no bypass |
| `POST` | `/v2/signupLogin/setAccessCode` | writes state shared by the whole environment (no self-cleaning lifecycle) |
| `POST` | `/v2/signupLogin/signup/` | needs an OTP validated in an earlier step; live has no bypass |
| `GET` | `/v2/signupLogin/userLogoutFromAllDevices/` | writes state shared by the whole environment (no self-cleaning lifecycle) |

### Katchup (4)

| Method | Path | Why not tested on live |
| ------ | ---- | ---------------------- |
| `GET` | `/v2/katchup/download/{uuid}` | needs a real uploaded attachment (S3 file upload) — the one file-upload gap |
| `GET` | `/v2/katchup/downloadThumbnail/{uuid}` | needs a real uploaded attachment (S3 file upload) — the one file-upload gap |
| `POST` | `/v2/katchup/generateThumbnailUsingUUID` | needs a real uploaded attachment (S3 file upload) — the one file-upload gap |
| `GET` | `/v2/katchup/mediaStreaming/{uuid}` | needs a real uploaded attachment (S3 file upload) — the one file-upload gap |

### Admin (2)

| Method | Path | Why not tested on live |
| ------ | ---- | ---------------------- |
| `POST` | `/rolePosting/getSuspendOrTerminateEmployee` | read needs setup we do not have (business-tier login answers 403; company logo 500s) |
| `POST` | `/workplaceHierarchy/getWorkPlaceHierarchy` | read needs setup we do not have (business-tier login answers 403; company logo 500s) |

### Contacts (1)

| Method | Path | Why not tested on live |
| ------ | ---- | ---------------------- |
| `POST` | `/testkmail/v2/common/postBoxContacts/` | read needs setup we do not have (business-tier login answers 403; company logo 500s) |

