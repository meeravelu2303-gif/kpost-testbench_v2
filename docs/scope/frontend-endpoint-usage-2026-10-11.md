# Frontend endpoint usage — end-to-end trace (2026-10-11)

Answers "which endpoints does the React app actually call, and does the bench cover exactly those?".
Deterministic extraction over `D:\KPOST_PROJECTS\KPOST_REACTJS_2023_V1\src` (no execution): every place a
base-URL constant from `Services/ServiceURL.js` (`EndPointURL` = `/v2`, `EndPoint`/`KOSEndPointURL`/
`KBooking_URL` = no prefix, `KmailEndPointURL` = `/testkmail/v2`, plus the precomputed media constants)
is concatenated with a literal path, comments stripped. Cross-checked against the registry dump (357
endpoints) and the backend route source (`KPOST_V5.0`, 355 routes).

## Headline

|                                                             |   Count |
| ----------------------------------------------------------- | ------: |
| Distinct endpoints the frontend **constructs** in live code |     212 |
| — registered **and** tested already                         | **199** |
| — constructed but **not** registered (examined below)       |      15 |
| Registered endpoints the frontend does **not** construct    |     120 |

**Method caveat (important):** "constructs in the service layer" is an upper bound on "the UI invokes
it". Some service wrappers are live but their only caller is commented out or absent — confirmed for
`addMembersToKall` (KoolKallModal.js:787 commented) and `forwardKatchupMessage` (imported into 3
ForwardFooter components, never invoked). So the true frontend-used set is slightly below 212; the
caller-liveness check was applied to every item in the 15-list below.

## The 15 constructed-but-not-registered, resolved

| Endpoint                                                                                                         | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/admin/updateCompanyDetails`, `/admin/updateBankAccountDetails`, `/admin/createKpostIDAndDesignationSuggestion` | **Real, FIXED.** Live-called (Setting.js UpdateCompanyDetails:829, UpdateBankAccountDetails:858, getKpostIDSugestion:708); backend serves them only on `AdminController` `/admin/*` — there is **no `/v2/admin/` route**. The bench had registered the `/v2/admin/*` paths (would 404). Repointed to `/admin/*` with the documented `/v2/admin/*` kept as `contractPath` for the schema.                                                                                                                                    |
| `/v2/kall/addMembersToKall`                                                                                      | Not used. Service fn `AddMembersToKoolKall` exists; its only caller (KoolKallModal.js:787) is commented out. Backend route exists but the UI never calls it. No action.                                                                                                                                                                                                                                                                                                                                                     |
| `/v2/katchup/forwardKatchupMessage`                                                                              | Not used. `SendForwardMessage` is imported by 3 ForwardFooter components but never invoked; only `forwardKatchupMessageNew` is live. Confirms the 2026-09-28 retirement — stays retired.                                                                                                                                                                                                                                                                                                                                    |
| `/v2/common/downloadProfileImage/{kpostID}`                                                                      | **Frontend bug, not a bench gap.** Login.js (1754, 2040) builds avatar URLs on `/common/downloadProfileImage`, a path the backend does not have; every other caller correctly uses `/profile/downloadProfileImage/{kpostID}` (registered as `profile-download-image`, tested). Flagged for the frontend team.                                                                                                                                                                                                               |
| `/testkmail/v2/kmailData/getKloudUsedData`                                                                       | **Real KMail gap, live-used** (DataStorage.js:64 → GetKlouDUsedDataList; backend `KmailDataController` `GET v2/kmailData/getKloudUsedData`). Uncovered due to a cross-host modelling issue — documented under the KPost contract but the real call hits the KMail host (`testkmail`), so neither `defineKpostEndpoint` (wrong host) nor `defineKmailEndpoint` (absent from that contract) models it cleanly. Close in the `kmail-api` pass. **The one genuinely-used endpoint the frontend calls that is not yet covered.** |
| `/testkmail/v2/sentMail/postMailMultiPart`                                                                       | **Not used — dead wrapper.** `sendMultiPartMailService` is imported by MailFooter.js and WriteMailBox.js but never invoked (MailFooter.js:532 commented); compose sends via `postMailService` → `/sentMail/postMail/` (WriteMailBox.js:542, WriteMailPage.js:1751, MailFooter.js:649). Backend route exists (SentMailController) but the current UI does not use it. Not a gap.                                                                                                                                             |
| `/razorPay/generateOrderId`, `/razorPay/validateAndUpdateTransactionDetails`                                     | Third-party payment (KBooking). Real money; out of scope, same standing as the taWallet/RedBus booking writes in `blocked-endpoints-rationale.md`.                                                                                                                                                                                                                                                                                                                                                                          |
| `/redbus/bookticket`, `/redbus/cancelticket`, `/redbus/getTicket`                                                | Third-party seat booking; already listed blocked (undocumented in workbook + real third-party side effects).                                                                                                                                                                                                                                                                                                                                                                                                                |
| `/v2/ecommerce/getEcommerceDetails`                                                                              | Third-party e-commerce, out of scope per BRD §4.2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `/v2/kposter`                                                                                                    | KPoster — runs in local IndexedDB demo mode by default; deployment unknown (`unused-endpoints.md`).                                                                                                                                                                                                                                                                                                                                                                                                                         |

**Net new coverage from this pass:** the 3 admin writes now point at the route the app and backend
actually use. The remaining 12 are either dead service wrappers, a frontend defect, a separate suite,
or deliberately out-of-scope third-party integrations — none is a KPost-API test gap.

## The 120 registered-but-not-constructed — keep, do not mass-delete

Per the owner "endpoints the frontend doesn't use we don't need to test" — but these split by why they
exist, and most earn their place:

- **Legacy V1 BOLA security probes** (`katchup/recallMessage`, `kall/setKallStatus`,
  `kall/cancelScheduleKall`, `kall/removeMemberKatchupKall`, `group/removeGroupMember`): dead from the
  frontend by design, kept because they test real, live, source-confirmed authorization holes. **Keep.**
- **OTP / global / credential writes** (`setAccessCode`, `userLogoutFromAllDevices`, `getMailCredentials`,
  `sendPrimaryDeviceOtp`, `updateCompanyLogo`, …): blocked on live already; contract-validated off-live.
  **Keep as-is.**
- **Genuinely dead-from-frontend reads/writes** (confirmed zero live callers: `getUserProfileUsingKpostID`
  — commented; `getTodaySchedules`, `fontSetting`, `katchupNotification`, `kmailNotification`,
  `getAllNotification`, `getPersonalize`, `searchKatchUpMessage`, `filterKatchUpMessage`,
  `importPhoneContacts`, `getKallStatus`, `fetchScheduledRepeatKall`, `forgotPasswordOrKpostID`,
  `getlanguages`, `updateDesignation`, and ~80 more): the app has drifted off these. They are cheap
  contract/negative-input checks that still guard the documented API, so they are **recorded as
  not-frontend-integrated rather than deleted** — deleting ~100 specs removes regression safety for no
  runtime saving. Descope any the owner chooses; none is counted as frontend coverage.

The full machine-readable diff (used / used-uncovered / unused) is regenerable from
`scratchpad/fe-extract.cjs` + `fe-diff.cjs` against the frontend source and the registry dump.
