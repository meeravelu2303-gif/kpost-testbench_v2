# KPost API — backend endpoints the bench does not test yet

From a full read of the backend (`D:\KPOST_PROJECTS\KPOST_V5.0`, branch `kpostV5_Qa`, 40 controllers) against
the bench's test lists, 2026-10-27. Proposals only: each needs a payload from the real client or the
workbook before it can be registered (CLAUDE.md §8: never invent a contract).

## Totals

| Group                                                                      | Backend endpoints | Tested (product run = regression) |
| -------------------------------------------------------------------------- | ----------------: | --------------------------------: |
| Current API (V2 + the unversioned admin, KDiary, settings, KBooking reads) |               249 |                               213 |
| Old V1 duplicates (V2 exists; still deployed)                              |                98 |                                 5 |
| KDoc / KOS / K-AI (excluded)                                               |                27 |                                 0 |
| KNews                                                                      |                12 |                                 0 |
| KBooking writes and other reads                                            |                15 |                                 6 |
| Payments, wallet, e-commerce                                               |                 9 |                                 0 |
| **Total**                                                                  |           **410** |                          **≈229** |

## 1. Current endpoints with no test (29)

Called by a client: `[web]` the React front end, `[app]` the Flutter app.

| Module           | Endpoints                                                                                                                                                                                                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Katchup          | `POST /v2/katchup/katchupSearch` [web], `POST /v2/katchup/changeCaption`, `POST /v2/katchup/uploadMultipartFiles`, `GET /v2/katchup/oldDownload/{uuid}`, `GET /v2/katchup/getDeletedKatchupMsgIds/{lastMsgID}`, `GET /v2/katchup/fetchReportMsgs`, `POST /v2/katchup/patchWorkForGroup` |
| Kall             | `POST /v2/kall/addMembersToKall` [web]                                                                                                                                                                                                                                                  |
| Profile          | `POST /v2/profile/setProfilePrivacy`, `POST /v2/profile/getDesignationOrProfession`, `POST /v2/profile/changeOrForgotAccessCode`, `GET /v2/profile/getStorageDetails`, `POST /v2/profile/kmailPasswordPatchWork`                                                                        |
| Common           | `POST /v2/common/sendMessage` [app], `POST /v2/common/country`, `GET /v2/common/getProfession`, `POST /v2/common/getDesignationByProfessionId`, `POST /v2/common/isCompanyNameExist`                                                                                                    |
| Dashboard        | `POST /v2/dashboard/kallDashboard`, `POST /v2/dashboard/getKmailDashboardMsg`                                                                                                                                                                                                           |
| Signup & Login   | `POST /v2/signupLogin/fetchPersonalUserDetails`, `POST /signupLoginForMediumAndLarge/addingUserByAdmin`                                                                                                                                                                                 |
| Admin (business) | `POST /admin/addingUserForReallocateByAdmin`                                                                                                                                                                                                                                            |
| KDiary           | `POST /dairySchedule/deleteReport`                                                                                                                                                                                                                                                      |
| AWS              | `GET /v2/aws/checkAttachmenS3/{uuid}`                                                                                                                                                                                                                                                   |
| Other            | `POST /v2/voice/translate` [web] [app], `GET /crypto/public-key`, `GET /v2/firebase/notificationForKall` (a test controller left in the build)                                                                                                                                          |

## 2. Old V1 controllers still deployed (98 endpoints, 5 tested)

`CommonController`, `ContactsDirectoryController`, `DashboardController`, `GroupController`, `KallController`,
`KatchupController`, `UserProfileController`, `SignUpLoginController`, and `KallControllerV2` (prefix
`unusedv2/kall`). The React app never calls them (it always uses `/v2`). They are live on the QA server and
answer differently from V2 (`GET /common/countries` → 401, `GET /v2/common/countries` → 200 public), and
the bench already found V1 writes skipping V2 fixes (`kall-legacy-writes-regression`). **The Flutter app's
`Test_ENV` build calls paths without `/v2`** (`${apiBaseUrl}profile/getUserProfile/`), so on a direct
backend the mobile app reaches these V1 routes. Ask the developers: remove them, or say which are still used.
Until then, at least an auth-gate and an owner-only (IDOR) check per V1 write.

## 3. Need an owner decision

- **KBooking writes** (`blockTicket`, `bookticket`, `cancelticket`, `getTicket`, `checkBookedTicket`) make real
  bookings; reads not yet tested: `seatLayout` [web], `getUpdatedFare`, `ticketdetails`, `updatecitylist`.
- **Payments**: `razorPay/*`, `taWallet/*`, `ecommerce/*` — the apps hold only a live Razorpay key.
- **KNews**: `v2/knews/*` settings and `admin/news/feeds/*` (sync, enable, disable): at least prove they
  require a login.

## 4. Bench definitions that do not match the backend

- `admin-update-role` called `/v2/admin/updateRole`; the backend serves `/admin/updateRole` (fixed
  2026-10-27, `contractPath` keeps the workbook name).
- `profile-forgot-password-or-kpostid` (`/v2/profile/forgotPasswordOrKpostID/`) does not exist in the backend;
  the Flutter app uses `/profile/forgotPWDorIDorAccessCode` (V1). It never runs (real SMS), so no false bugs;
  the workbook entry needs the developers' answer.
