# OTP-dependent endpoints — the complete list (KPost · KMail · Admin)

Every endpoint that needs an OTP to work, across all three products. **All of these are BLOCKED on the
live application** — the bench can never send or use a real OTP (the SMS/OTP kill-switch is absolute,
no flag unlocks it), so an OTP flow cannot be exercised on live. This is a safety property, not a
coverage gap.

Derived from the generated contracts by `npm run contract:otp` (source: `contracts/otp-dependent-endpoints.md`).

**The three ways an endpoint depends on an OTP:**

- **SENDS** — the call itself delivers a real OTP by SMS or email to a real recipient.
- **CONSUMES** — its request payload carries an `otp` field we cannot obtain.
- **REQUIRES** — nothing in its own payload shows an OTP, but it fails unless an OTP was validated in
  an earlier step (the sneaky ones — they look clean and fail anyway).

---

## KPOST API — 16 OTP-dependent endpoints

### SENDS (6) — deliver a real SMS / email

| Method | Endpoint                                                     |
| ------ | ------------------------------------------------------------ |
| POST   | `/v2/common/sendOTP/`                                        |
| POST   | `/v2/common/sendOTPtoMail/`                                  |
| POST   | `/v2/common/forgotPasswordOTPOrSentKpostIDSms`              |
| GET    | `/v2/profile/sendAccountDeactivationOtp/`                   |
| GET    | `/v2/profile/sendPrimaryDeviceOtp/`                         |
| GET    | `/v2/profile/sendPrimaryOrSecondaryDeviceOtp/{requestType}` |

### CONSUMES (2) — the payload carries an `otp`

| Method | Endpoint                      |
| ------ | ----------------------------- |
| POST   | `/v2/common/validateOTP/`     |
| POST   | `/v2/common/validateMailOTP/` |

### REQUIRES (8) — an OTP validated in an earlier step

| Method | Endpoint                             | Confidence |
| ------ | ------------------------------------ | ---------- |
| POST   | `/v2/common/forgotPasswordUpdate`    | verified   |
| POST   | `/v2/signupLogin/signup/`            | verified (personal registration)  |
| POST   | `/v2/signupLogin/adminRegistration/` | verified (business registration)  |
| POST   | `/v2/profile/deactivateAccount/`     | inferred   |
| POST   | `/v2/profile/setDeviceAsPrimary/`    | inferred   |
| POST   | `/v2/profile/setDeviceAsSecondary`   | inferred   |
| POST   | `/v2/profile/updateDeviceAsPrimary/` | inferred   |
| POST   | `/v2/profile/updateDeviceAsSecondary`| inferred   |

_Also **MENTIONS (1)**, allowed to run (sends/consumes no OTP): `POST /v2/profile/forgotPasswordOrKpostID/`._

---

## KMAIL API — 0 dedicated OTP endpoints

No KMail endpoint sends, consumes, or requires an OTP in the contract. The one OTP-related case is the
**mail-OTP**, which is a **variant of `POST /kmail5/v2/sentMail/postMail/`** sent with `kmailType = 12`
(not a separate endpoint) — that variant would deliver a real OTP, so it is not sent on live. Ordinary
KMail send/read/draft/settings endpoints are OTP-free.

---

## ADMIN API — 0 OTP endpoints

The Admin / HR-Setup module is **SSO-based** — it reuses the KPost login token (no login screen, no
OTP of its own). None of its workplace / HR / employee / role-posting endpoints send, consume, or
require an OTP.

---

## Summary

| Product   | SENDS | CONSUMES | REQUIRES | Total OTP-gated |
| --------- | ----: | -------: | -------: | --------------: |
| KPost API |     6 |        2 |        8 |          **16** |
| KMail API |     0 |        0 |        0 |           **0** |
| Admin API |     0 |        0 |        0 |           **0** |

Regenerate the KPost/KMail figures with `npm run contract:otp`.
