# Endpoints that depend on an OTP

**GENERATED — do not edit.** `node scripts/otp-dependency-report.cjs`

The dev host has an OTP bypass (`123456` always validates). **Production does not, and must
not.** So every flow below is untestable against the live application until a real code is
delivered to a real device and entered by a human.

**16 endpoints are blocked on live.** One more mentions an OTP but neither sends nor consumes one, so it runs normally.

| Category | Count | What it means on live |
| -------- | ----: | --------------------- |
| `REQUIRES` | 8 | BLOCKED — needs an OTP validated in a prior step |
| `CONSUMES` | 2 | BLOCKED — needs a real OTP we cannot obtain |
| `SENDS` | 6 | BLOCKED — sends a real SMS/email to a real recipient |
| `MENTIONS` | 1 | allowed — no OTP is sent or consumed |

**The consequence that matters: no account can be created on live by this bench.** Both
registration endpoints are in `REQUIRES`, so the QA accounts have to be created by hand or by
the developers, and their credentials supplied to the bench afterwards.

### REQUIRES — an OTP validated in an earlier step — 8

Nothing in these endpoints’ payloads mentions an OTP, so the contract cannot reveal this. **They look clean and fail on live anyway** — which is exactly why this list is curated by hand from observed behaviour rather than derived.

| Method | Path | Module | Workbook | Confidence | Why |
| ------ | ---- | ------ | -------- | ---------- | --- |
| POST | `/v2/common/forgotPasswordUpdate` | common | KatchupAPI!R7 | verified | Set a new password after password recovery |
| POST | `/v2/profile/deactivateAccount/` | profile | KatchupAPI!R121 | **inferred** | Deactivate the signed-in account |
| POST | `/v2/profile/setDeviceAsPrimary/` | profile | KatchupAPI!R124 | **inferred** | Register this device as the primary device |
| POST | `/v2/profile/setDeviceAsSecondary` | profile | KatchupAPI!R130 | **inferred** | Register this device as a secondary device |
| POST | `/v2/profile/updateDeviceAsPrimary/` | profile | KatchupAPI!R126 | **inferred** | Move the primary-device designation to this device |
| POST | `/v2/profile/updateDeviceAsSecondary` | profile | KatchupAPI!R131 | **inferred** | Move a secondary-device designation to this device |
| POST | `/v2/signupLogin/adminRegistration/` | Business,Institution sigunp | KatchupAPI!R168 | verified | Business account + company registration (BUSINESS_S/M/L) |
| POST | `/v2/signupLogin/signup/` | Signup | KatchupAPI!R17 | verified | Personal account registration |

### CONSUMES — the payload carries an OTP field — 2

Derived from the documented request payload. Without a real code these can only ever be exercised with an invalid OTP, which tests the rejection path and nothing else.

| Method | Path | Module | Workbook | Confidence | Why |
| ------ | ---- | ------ | -------- | ---------- | --- |
| POST | `/v2/common/validateMailOTP/` | common | KatchupAPI!R13 | verified | payload carries otp |
| POST | `/v2/common/validateOTP/` | common | KatchupAPI!R8 | verified | payload carries otp |

### SENDS — delivers a real SMS or email — 6

These would *work* on live, which is the problem: each call costs money and reaches a real phone or mailbox. Note that the negative probes mutate the recipient field, so a run would message numbers that are not ours. Already fenced as `sideEffect: external`.

| Method | Path | Module | Workbook | Confidence | Why |
| ------ | ---- | ------ | -------- | ---------- | --- |
| POST | `/v2/common/forgotPasswordOTPOrSentKpostIDSms` | common | KatchupAPI!R9 | verified | delivers a real OTP by SMS or email |
| POST | `/v2/common/sendOTP/` | — | V2 TESTED APIS!R8 | verified | delivers a real OTP by SMS or email |
| POST | `/v2/common/sendOTPtoMail/` | common | KatchupAPI!R12 | verified | delivers a real OTP by SMS or email |
| GET | `/v2/profile/sendAccountDeactivationOtp/` | profile | KatchupAPI!R122 | verified | delivers a real OTP by SMS or email |
| GET | `/v2/profile/sendPrimaryDeviceOtp/` | profile | KatchupAPI!R123 | verified | delivers a real OTP by SMS or email |
| GET | `/v2/profile/sendPrimaryOrSecondaryDeviceOtp/{requestType}` | profile | KatchupAPI!R129 | verified | delivers a real OTP by SMS or email |

### MENTIONS — informational only — 1

OTP appears in the sample response or the notes, but the endpoint neither sends nor consumes one. Listed so nobody skips them by a careless text search for "otp".

| Method | Path | Module | Workbook | Confidence | Why |
| ------ | ---- | ------ | -------- | ---------- | --- |
| POST | `/v2/profile/forgotPasswordOrKpostID/` | — | V2 TESTED APIS!R9 | verified | OTP referenced in the sample response or notes only |

## The evidence behind each `REQUIRES` entry

**`POST /v2/signupLogin/signup/`** — Personal account registration  (verified)

Gated by: `/v2/common/sendOTP/ + /v2/common/sendOTPtoMail/`

> Both the mobile and the mail OTP must be sent AND validated first. Every attempt without validateMailOTP fails with "No OTP was found for the given mobileNumber/otherEmail". On live it also returns 400 "Enter valid Credentials" for reasons still unexplained.

**`POST /v2/signupLogin/adminRegistration/`** — Business account + company registration (BUSINESS_S/M/L)  (verified)

Gated by: `/v2/common/sendOTP/ + /v2/common/sendOTPtoMail/`

> Verified 5-step sequence: sendOTP(requestType:"signup") -> sendOTPtoMail -> validateOTP -> validateMailOTP -> adminRegistration. Skipping validateMailOTP fails the final step. This is how the three meera23* accounts were created on dev.

**`POST /v2/common/forgotPasswordUpdate`** — Set a new password after password recovery  (verified)

Gated by: `/v2/common/forgotPasswordOTPOrSentKpostIDSms (and an unknown validator)`

> Answers 400 "OTP validation failed" until an OTP is validated for that account. The documented validateOTP does NOT satisfy it (validated successfully, endpoint still 400) — the flow keeps its own OTP state reached by a call absent from the workbook.

**`POST /v2/profile/deactivateAccount/`** — Deactivate the signed-in account  (**inferred**)

Gated by: `/v2/profile/sendAccountDeactivationOtp/`

> A dedicated sender exists (sendAccountDeactivationOtp) and no endpoint consumes its code, so deactivateAccount must verify it server-side. Its payload is only {"reason"} — the contract gives no hint. Not run: it would deactivate a live account.

**`POST /v2/profile/setDeviceAsPrimary/`** — Register this device as the primary device  (**inferred**)

Gated by: `/v2/profile/sendPrimaryDeviceOtp/`

> Paired with sendPrimaryDeviceOtp; no other endpoint consumes that code.

**`POST /v2/profile/updateDeviceAsPrimary/`** — Move the primary-device designation to this device  (**inferred**)

Gated by: `/v2/profile/sendPrimaryDeviceOtp/`

> Paired with sendPrimaryDeviceOtp; no other endpoint consumes that code.

**`POST /v2/profile/setDeviceAsSecondary`** — Register this device as a secondary device  (**inferred**)

Gated by: `/v2/profile/sendPrimaryOrSecondaryDeviceOtp/{requestType}`

> Paired with sendPrimaryOrSecondaryDeviceOtp; no other endpoint consumes that code.

**`POST /v2/profile/updateDeviceAsSecondary`** — Move a secondary-device designation to this device  (**inferred**)

Gated by: `/v2/profile/sendPrimaryOrSecondaryDeviceOtp/{requestType}`

> Paired with sendPrimaryOrSecondaryDeviceOtp; no other endpoint consumes that code.

