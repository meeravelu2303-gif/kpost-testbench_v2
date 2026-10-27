import { testData } from '@config/test-data.config';
import { body, defineKpostEndpoint } from '../kpost-endpoint';

/**
 * Public OTP and password-recovery endpoints. Senders are destructive because they reach a real
 * person (SMS, email, a new password); rate-limit probes stay off because every send is billed.
 */
const OTP_TAGS = ['common', 'common-otp', 'security-sensitive'] as const;

export const sendOtpApi = defineKpostEndpoint({
  id: 'common-send-otp',
  // Needs a real OTP and live has no bypass (reconciled by tests/framework/live-safety.spec.ts)
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
  // Needs a real OTP and live has no bypass (reconciled by tests/framework/live-safety.spec.ts)
  otpDependent: 'consumes',
  method: 'POST',
  path: '/v2/common/validateOTP/',
  summary: 'Validate a mobile OTP',
  // `otp-consume` keeps it out of the standalone engine run: it needs a prior sendOTP in the same
  // run, so it is covered by the OTP signup lifecycle instead.
  tags: [...OTP_TAGS, 'otp-consume'],
  destructive: false,
  note: 'lifecycle-only: needs a prior sendOTP session in the same run (standalone → 500 "OTP validation failed", a bench-precondition, not a product defect); covered by otp-signup-lifecycle',
  // Matches the Signup UI's payload exactly, `sendDate` included.
  request: body(() => ({
    otp: testData.bypassOtp,
    countryID: testData.countryId,
    mobileNumber: testData.mobileExists,
    sendDate: Date.now(),
  })),
});

export const sendOtpToMailApi = defineKpostEndpoint({
  id: 'common-send-otp-to-mail',
  // Needs a real OTP and live has no bypass (reconciled by tests/framework/live-safety.spec.ts)
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
  // Needs a real OTP and live has no bypass (reconciled by tests/framework/live-safety.spec.ts)
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
  // Needs a real OTP and live has no bypass (reconciled by tests/framework/live-safety.spec.ts)
  otpDependent: 'sends',
  method: 'POST',
  path: '/v2/common/forgotPasswordOTPOrSentKpostIDSms',
  summary: 'Send a password-reset OTP, or the KPost ID, by SMS',
  tags: OTP_TAGS,
  destructive: true,
  sideEffect: 'external',
  // This OTP is real, so the probes (each a send) are off; send-free negatives are in
  // forgot-password-limited.spec.ts.
  validations: {
    request: false,
    security: false,
    authentication: false,
    authorization: false,
    concurrency: false,
  },
  request: body(() => ({ kpostID: testData.kpostId, requestType: 'password' })),
});

export const forgotPasswordUpdateApi = defineKpostEndpoint({
  id: 'common-forgot-password-update',
  // Needs a real OTP and live has no bypass (reconciled by tests/framework/live-safety.spec.ts)
  otpDependent: 'requires',
  method: 'POST',
  path: '/v2/common/forgotPasswordUpdate',
  summary: 'Set a new password after a successful OTP check',
  tags: [...OTP_TAGS, 'account-takeover-surface'],
  // Changes a password with no token: an account-takeover surface. Never runs without the explicit
  // flag.
  destructive: true,
  sideEffect: 'global',
  // A spare account, never the login account, reset to the standard password so the call is
  // idempotent. A 400 "OTP validation failed" without a validated OTP is correct, not a defect.
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
