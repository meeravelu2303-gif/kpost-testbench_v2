import { testData } from '@config/test-data.config';
import { body, defineKpostEndpoint } from '../kpost-endpoint';

/**
 * OTP and password-recovery endpoints of the common module. All public — they are called before
 * anyone has a token, which is exactly why they are the most exposed surface in the product.
 *
 * ## Every endpoint here is `destructive: true`
 *
 * Not because it deletes anything, but because it **sends something to a real person**: an SMS to
 * a mobile number, an email to a mailbox, or a new password onto an account. The central
 * production guard blocks these unless `ALLOW_DESTRUCTIVE_TESTS=true`, so a default run against a
 * live host cannot text a customer. The destinations come from `testData.otpMobile` /
 * `testData.otpEmail`, which must be throwaway.
 *
 * ## Rate limiting is off by default
 *
 * `security.rateLimit` would fire dozens of sends to find the throttle. That is a real cost (SMS
 * is billed) and a real risk (an IP ban mid-run makes every later test fail for the wrong
 * reason). Enable it deliberately, per endpoint, when the throttle is what you mean to test.
 */
const OTP_TAGS = ['common', 'common-otp', 'security-sensitive'] as const;

export const sendOtpApi = defineKpostEndpoint({
  id: 'common-send-otp',
  // Needs a real OTP and live has no bypass: contracts/otp-dependent-endpoints.md
  otpDependent: 'sends',
  method: 'POST',
  path: '/v2/common/sendOTP/',
  summary: 'Send a signup OTP to a mobile number',
  tags: OTP_TAGS,
  destructive: true,
  sideEffect: 'external',
  request: body(() => ({
    countryID: testData.countryId,
    mobileNumber: testData.otpMobile,
    requestType: 'signup',
  })),
});

export const validateOtpApi = defineKpostEndpoint({
  id: 'common-validate-otp',
  // Needs a real OTP and live has no bypass: contracts/otp-dependent-endpoints.md
  otpDependent: 'consumes',
  method: 'POST',
  path: '/v2/common/validateOTP/',
  summary: 'Validate a mobile OTP',
  // `otp-consume` excludes it from the STANDALONE engine run (otp.spec.ts excludeTags): validating an
  // OTP requires a live session created by a PRIOR sendOTP in the same run, which the standalone engine
  // does not do — so standalone it always answers 500 "OTP validation failed" (verified by curl
  // 2026-09-19: bare validateOTP → 500; sendOTP then validateOTP → 200). It is exercised end-to-end by
  // the OTP signup lifecycle (send → validate). The `common-otp` tag is kept for component routing.
  tags: [...OTP_TAGS, 'otp-consume'],
  destructive: false,
  note: 'lifecycle-only: needs a prior sendOTP session in the same run (standalone → 500 "OTP validation failed", a bench-precondition, not a product defect); covered by otp-signup-lifecycle',
  // Payload matches the WORKING live call (owner-verified curl 2026-09-19): { otp, countryID,
  // mobileNumber }. The earlier `sendDate: Date.now()` (a 13-digit epoch) pushed it into a failure
  // path that answered 500 — a bench-payload artifact, not a product defect. `mobileNumber` is the
  // configured QA number (set QA_MOBILE_EXISTS to a number the bypass validates on the test env).
  request: body(() => ({
    otp: testData.bypassOtp,
    countryID: testData.countryId,
    mobileNumber: testData.mobileExists,
  })),
});

export const sendOtpToMailApi = defineKpostEndpoint({
  id: 'common-send-otp-to-mail',
  // Needs a real OTP and live has no bypass: contracts/otp-dependent-endpoints.md
  otpDependent: 'sends',
  method: 'POST',
  path: '/v2/common/sendOTPtoMail/',
  summary: 'Send an OTP to an email address',
  tags: OTP_TAGS,
  destructive: true,
  sideEffect: 'external',
  request: body(() => ({ otherEmail: testData.otpEmail })),
});

export const validateMailOtpApi = defineKpostEndpoint({
  id: 'common-validate-mail-otp',
  // Needs a real OTP and live has no bypass: contracts/otp-dependent-endpoints.md
  otpDependent: 'consumes',
  method: 'POST',
  path: '/v2/common/validateMailOTP/',
  summary: 'Validate an email OTP',
  // Lifecycle-only, like validateOTP: needs a prior sendOTPtoMail session in the same run, so the
  // standalone engine run 500s. Excluded via `otp-consume`; covered by the OTP signup lifecycle.
  tags: [...OTP_TAGS, 'otp-consume'],
  destructive: false,
  note: 'lifecycle-only: needs a prior sendOTPtoMail session (standalone → 500, a bench-precondition); covered by otp-signup-lifecycle',
  // Matches the working validateOTP shape (no `sendDate` epoch, which triggered a 500 failure path).
  request: body(() => ({
    email: testData.otpEmail,
    otp: Number(testData.bypassOtp),
  })),
});

export const forgotPasswordOtpApi = defineKpostEndpoint({
  id: 'common-forgot-password-otp',
  // Needs a real OTP and live has no bypass: contracts/otp-dependent-endpoints.md
  otpDependent: 'sends',
  method: 'POST',
  path: '/v2/common/forgotPasswordOTPOrSentKpostIDSms',
  summary: 'Send a password-reset OTP, or the KPost ID, by SMS',
  tags: OTP_TAGS,
  destructive: true,
  sideEffect: 'external',
  request: body(() => ({ kpostID: testData.kpostId, requestType: 'password' })),
});

export const forgotPasswordUpdateApi = defineKpostEndpoint({
  id: 'common-forgot-password-update',
  // Needs a real OTP and live has no bypass: contracts/otp-dependent-endpoints.md
  otpDependent: 'requires',
  method: 'POST',
  path: '/v2/common/forgotPasswordUpdate',
  summary: 'Set a new password after a successful OTP check',
  tags: [...OTP_TAGS, 'account-takeover-surface'],
  /*
   * The single most dangerous endpoint in the common module: it changes a password and requires no
   * token. If it accepts a kpostID without proof that the caller holds the OTP, anyone can take
   * over any account. The central authorization and injection validators probe exactly that, and
   * it stays destructive so a default run never rewrites a real password.
   */
  // Rewrites an account's password: shared state, never run without the explicit flag.
  destructive: true,
  sideEffect: 'global',
  /*
   * Payload exactly as documented: `{ kpostID, forgotPassword }`.
   *
   * Two deliberate choices about the values:
   *
   *  - **A spare account**, never `testData.kpostId`. A successful call rewrites the password that
   *    every other suite logs in with, and the whole run would then fail on authentication.
   *    `QA_FORGOT_PASSWORD_KPOST_ID` is `meera962@kpostindia.com`, verified to exist.
   *  - **The new password is the standard one.** Setting it to `QA_PASSWORD` makes the call
   *    idempotent: the spare keeps a credential we know, so the endpoint can be exercised as often
   *    as needed without locking anybody out or needing a reset afterwards. A random password would
   *    work once and leave an account nobody can log into.
   *
   * ## Its current 400 is a missing prerequisite, not a defect
   *
   * The live endpoint answers `400 "OTP validation failed"` until an OTP has been validated for
   * that account - which is the correct behaviour, and good news: the password cannot be changed
   * without one. But the step that satisfies it is not the documented `validateOTP`: calling
   * `forgotPasswordOTPOrSentKpostIDSms` and then `validateOTP` with the bypass code still leaves it
   * at 400, so the flow keeps its own OTP state reached by some other call. Open with the API owner
   * (see CLAUDE.md §9). Recorded here so the 400 is not filed as a bug.
   */
  request: body(() => ({
    kpostID: testData.forgotPasswordKpostId,
    forgotPassword: testData.password,
  })),
});

export const otpApis = [
  sendOtpApi,
  validateOtpApi,
  sendOtpToMailApi,
  validateMailOtpApi,
  forgotPasswordOtpApi,
  forgotPasswordUpdateApi,
];
