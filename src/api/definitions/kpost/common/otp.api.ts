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
  method: 'POST',
  path: '/v2/common/validateOTP/',
  summary: 'Validate a mobile OTP',
  tags: OTP_TAGS,
  /*
   * The happy path is reachable because this environment has a developer bypass OTP that always
   * validates (QA_BYPASS_OTP). So the primary request is a genuine success, and the central
   * negative probes supply the rejection cases - including a wrong OTP, which currently answers
   * HTTP 500 instead of a 4xx.
   */
  destructive: false,
  request: body(() => ({
    otp: testData.bypassOtp,
    countryID: testData.countryId,
    mobileNumber: testData.mobileExists,
    sendDate: Date.now(),
  })),
});

export const sendOtpToMailApi = defineKpostEndpoint({
  id: 'common-send-otp-to-mail',
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
  method: 'POST',
  path: '/v2/common/validateMailOTP/',
  summary: 'Validate an email OTP',
  tags: OTP_TAGS,
  destructive: false,
  request: body(() => ({
    email: testData.otpEmail,
    sendDate: Date.now(),
    otp: Number(testData.bypassOtp),
  })),
});

export const forgotPasswordOtpApi = defineKpostEndpoint({
  id: 'common-forgot-password-otp',
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
   * Deliberately NOT testData.kpostId: a successful call rewrites that account's password and
   * every other suite logs in with it. QA_FORGOT_PASSWORD_KPOST_ID defaults to an address that
   * does not exist, so an unconfigured run cannot change a real credential.
   */
  request: body(() => ({
    kpostID: testData.forgotPasswordKpostId,
    forgotPassword: `Qa!${Date.now().toString().slice(-8)}`,
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
