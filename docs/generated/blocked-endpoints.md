# Endpoints NOT tested on the live application

**GENERATED — do not edit.** Written by `tests/framework/live-coverage.spec.ts`.

**54 of 401** registered endpoints are **not driven against the live app**.
The rest ARE tested on live: **144** on the default run + **203** via the
gated self-cleaning lifecycle flows (`npm run product:kpost-api:file`). This file lists ONLY the not-tested.

They are not silent gaps — each is refused for a permanent constraint or a deliberate safety
choice, and every one is still contract-validated OFF live.

## Count by category

| Category | Count |
| -------- | ----: |
| Shared / global write (by choice) | 22 |
| OTP — no bypass on live (permanent) | 17 |
| Real SMS / email to a real recipient | 7 |
| Needs setup we lack (business login 403, company logo 500) | 3 |
| Public record write (enquiry / unsubscribe) | 2 |
| Route not deployed on this test build (confirmed 404) | 2 |
| Written, execution blocked pending explicit owner authorization | 1 |
| **Total not tested on live** | **54** |

---

## The endpoints, module by module

### common · company (12)

| Method | Path | Why not tested on live |
| ------ | ---- | ---------------------- |
| `POST` | `/admin/addingUserByAdmin/` | writes state shared by the whole environment (no self-cleaning lifecycle) |
| `POST` | `/admin/addingUserForReallocateByAdmin` | writes state shared by the whole environment (no self-cleaning lifecycle) |
| `POST` | `/admin/createOrRemoveBackupAdmin/` | writes state shared by the whole environment (no self-cleaning lifecycle) |
| `POST` | `/admin/holdOrRelease/` | writes state shared by the whole environment (no self-cleaning lifecycle) |
| `POST` | `/admin/removeCompanyLogo` | writes state shared by the whole environment (no self-cleaning lifecycle) |
| `POST` | `/admin/resetPassword/` | sends a real SMS or email to a real recipient |
| `POST` | `/admin/terminateUser/` | writes state shared by the whole environment (no self-cleaning lifecycle) |
| `POST` | `/admin/updateBankAccountDetails` | writes state shared by the whole environment (no self-cleaning lifecycle) |
| `POST` | `/admin/updateCompanyDetails` | writes state shared by the whole environment (no self-cleaning lifecycle) |
| `POST` | `/admin/updateRole` | writes state shared by the whole environment (no self-cleaning lifecycle) |
| `GET` | `/v2/common/downloadCompanyLogo/{companyID}` | read needs setup we do not have (business-tier login answers 403; company logo 500s) |
| `POST` | `/v2/common/updateCompanyLogo` | writes state shared by the whole environment (no self-cleaning lifecycle) |

### Profile (11)

| Method | Path | Why not tested on live |
| ------ | ---- | ---------------------- |
| `POST` | `/v2/profile/changeOrForgotAccessCode` | writes state shared by the whole environment (no self-cleaning lifecycle) |
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

### common (8)

| Method | Path | Why not tested on live |
| ------ | ---- | ---------------------- |
| `POST` | `/v2/common/forgotPasswordOTPOrSentKpostIDSms` | sends a real OTP by SMS/email to a real recipient |
| `POST` | `/v2/common/forgotPasswordUpdate` | needs an OTP validated in an earlier step; live has no bypass |
| `POST` | `/v2/common/saveEnquiryDetails` | persists a real shared record (enquiry / unsubscribe) — no self-cleaning lifecycle |
| `POST` | `/v2/common/sendOTP/` | sends a real OTP by SMS/email to a real recipient |
| `POST` | `/v2/common/sendOTPtoMail/` | sends a real OTP by SMS/email to a real recipient |
| `POST` | `/v2/common/updateFlutterAppVersion` | writes state shared by the whole environment (no self-cleaning lifecycle) |
| `POST` | `/v2/common/validateMailOTP/` | needs a real OTP in its payload; live has no bypass |
| `POST` | `/v2/common/validateOTP/` | needs a real OTP in its payload; live has no bypass |

### Login & session (6)

| Method | Path | Why not tested on live |
| ------ | ---- | ---------------------- |
| `POST` | `/signupLoginForMediumAndLarge/addingUserByAdmin` | writes state shared by the whole environment (no self-cleaning lifecycle) |
| `POST` | `/signupLoginForMediumAndLarge/adminUserLogin` | read needs setup we do not have (business-tier login answers 403; company logo 500s) |
| `POST` | `/v2/signupLogin/adminRegistration/` | needs an OTP validated in an earlier step; live has no bypass |
| `POST` | `/v2/signupLogin/setAccessCode` | writes state shared by the whole environment (no self-cleaning lifecycle) |
| `POST` | `/v2/signupLogin/signup/` | needs an OTP validated in an earlier step; live has no bypass |
| `GET` | `/v2/signupLogin/userLogoutFromAllDevices/` | writes state shared by the whole environment (no self-cleaning lifecycle) |

### other (5)

| Method | Path | Why not tested on live |
| ------ | ---- | ---------------------- |
| `PUT` | `/admin/news/feeds/{feedId}/disable` | writes state shared by the whole environment (no self-cleaning lifecycle) |
| `PUT` | `/admin/news/feeds/{feedId}/enable` | writes state shared by the whole environment (no self-cleaning lifecycle) |
| `POST` | `/admin/news/feeds/sync` | writes state shared by the whole environment (no self-cleaning lifecycle) |
| `POST` | `/redbus/blockTicket/{kpostId}` | no env flag actually gates this (KBOOKING_LIFECYCLE is referenced only in comments) — unconditionally test.skip'd pending explicit owner authorization, not driven by any lifecycle flow |
| `GET` | `/redbus/updatecitylist` | writes state shared by the whole environment (no self-cleaning lifecycle) |

### Admin (4)

| Method | Path | Why not tested on live |
| ------ | ---- | ---------------------- |
| `POST` | `/rolePosting/delete` | sends a real SMS or email to a real recipient |
| `POST` | `/rolePosting/save` | sends a real SMS or email to a real recipient |
| `POST` | `/rolePosting/suspendOrTerminateEmployee` | sends a real SMS or email to a real recipient |
| `POST` | `/rolePosting/update` | sends a real SMS or email to a real recipient |

### Katchup (4)

| Method | Path | Why not tested on live |
| ------ | ---- | ---------------------- |
| `POST` | `/v2/katchup/changeCaption` | writes state shared by the whole environment (no self-cleaning lifecycle) |
| `GET` | `/v2/katchup/getKatchupMessagesSubject/{id}` | route not deployed on this test build (confirmed 404 — needs the dev to confirm deployment, not a business-account gap) |
| `POST` | `/v2/katchup/uploadMultipartFiles/` | writes state shared by the whole environment (no self-cleaning lifecycle) |
| `POST` | `/v2/voice/translate` | sends a real SMS or email to a real recipient |

### KMail (2)

| Method | Path | Why not tested on live |
| ------ | ---- | ---------------------- |
| `POST` | `/v2/common/saveUnsubscriberDetails` | persists a real shared record (enquiry / unsubscribe) — no self-cleaning lifecycle |
| `POST` | `/v2/sentMail/getMailCredentials/` | read needs setup we do not have (business-tier login answers 403; company logo 500s) |

### Kall (1)

| Method | Path | Why not tested on live |
| ------ | ---- | ---------------------- |
| `GET` | `/v2/firebase/notificationForKall` | sends a real SMS or email to a real recipient |

### KOS (1)

| Method | Path | Why not tested on live |
| ------ | ---- | ---------------------- |
| `GET` | `/kword/documents/` | route not deployed on this test build (confirmed 404 — needs the dev to confirm deployment, not a business-account gap) |

