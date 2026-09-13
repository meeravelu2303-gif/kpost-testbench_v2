import { testData } from '@config/test-data.config';
import { body, pathParams } from '../kpost-endpoint';
import { defineProfileEndpoint } from './profile-endpoint';

/**
 * Profile **device management and account security** — primary/secondary device designation, the
 * OTP senders that gate them, password change, forgot-password, and account deactivation.
 *
 * Two hard-blocked classes here:
 *
 *  - **OTP senders** (`send*Otp`) deliver a real SMS/email → `sideEffect: 'external'`.
 *  - **The actions they gate** (`setDeviceAs*`, `updateDeviceAs*`, `deactivateAccount`) need a
 *    validated OTP that live has no bypass for → `otpDependent`. `deactivateAccount` would also
 *    disable our own account, and `changePassword` would change the credential every suite logs in
 *    with — both stay `global`, never cleared for live.
 */
const DEVICE_TAGS = ['profile-device'] as const;

export const sendPrimaryDeviceOtpApi = defineProfileEndpoint({
  id: 'profile-send-primary-device-otp',
  method: 'GET',
  path: '/v2/profile/sendPrimaryDeviceOtp/',
  summary: 'Send the OTP to designate a primary device',
  tags: [...DEVICE_TAGS, 'otp'],
  destructive: true,
  sideEffect: 'external',
  otpDependent: 'sends',
});

export const sendPrimaryOrSecondaryDeviceOtpApi = defineProfileEndpoint({
  id: 'profile-send-device-otp',
  method: 'GET',
  path: '/v2/profile/sendPrimaryOrSecondaryDeviceOtp/{requestType}',
  summary: 'Send the OTP to designate a primary or secondary device',
  tags: [...DEVICE_TAGS, 'otp'],
  destructive: true,
  sideEffect: 'external',
  otpDependent: 'sends',
  request: pathParams(() => ({ requestType: 'primary' })),
});

export const sendDeactivationOtpApi = defineProfileEndpoint({
  id: 'profile-send-deactivation-otp',
  method: 'GET',
  path: '/v2/profile/sendAccountDeactivationOtp/',
  summary: 'Send the OTP to deactivate the account',
  tags: [...DEVICE_TAGS, 'otp'],
  destructive: true,
  sideEffect: 'external',
  otpDependent: 'sends',
});

export const setDevicePrimaryApi = defineProfileEndpoint({
  id: 'profile-set-device-primary',
  method: 'POST',
  path: '/v2/profile/setDeviceAsPrimary/',
  summary: 'Set a device as the primary device',
  tags: [...DEVICE_TAGS],
  destructive: true,
  sideEffect: 'global',
  otpDependent: 'requires',
  request: body(() => ({ deviceIdentity_primary: 'qa-bench-device' })),
});

export const updateDevicePrimaryApi = defineProfileEndpoint({
  id: 'profile-update-device-primary',
  method: 'POST',
  path: '/v2/profile/updateDeviceAsPrimary/',
  summary: 'Update the primary device',
  tags: [...DEVICE_TAGS],
  destructive: true,
  sideEffect: 'global',
  otpDependent: 'requires',
  request: body(() => ({ deviceIdentity_primary: 'qa-bench-device' })),
});

export const setDeviceSecondaryApi = defineProfileEndpoint({
  id: 'profile-set-device-secondary',
  method: 'POST',
  path: '/v2/profile/setDeviceAsSecondary',
  summary: 'Set a device as a secondary device',
  tags: [...DEVICE_TAGS],
  destructive: true,
  sideEffect: 'global',
  otpDependent: 'requires',
  request: body(() => ({ deviceIdentity_secondary: 'qa-bench-device' })),
});

export const updateDeviceSecondaryApi = defineProfileEndpoint({
  id: 'profile-update-device-secondary',
  method: 'POST',
  path: '/v2/profile/updateDeviceAsSecondary',
  summary: 'Update a secondary device',
  tags: [...DEVICE_TAGS],
  destructive: true,
  sideEffect: 'global',
  otpDependent: 'requires',
  request: body(() => ({ deviceIdentity_secondary: 'qa-bench-device' })),
});

export const changePasswordApi = defineProfileEndpoint({
  id: 'profile-change-password',
  method: 'POST',
  path: '/v2/profile/changePassword',
  summary: "Change the caller's password",
  tags: [...DEVICE_TAGS, 'security'],
  /*
   * Changes the credential every other suite logs in with — running it on live would lock the QA
   * account out mid-run. `global`, never cleared for live. The documented sample is missing a
   * `newPassword` field (it has old + confirm only), which the null/required probes will surface.
   */
  destructive: true,
  sideEffect: 'global',
  request: body(() => ({
    oldPassword: testData.password,
    newPassword: testData.password,
    confirmPassword: testData.password,
  })),
});

export const forgotPasswordOrKpostIdApi = defineProfileEndpoint({
  id: 'profile-forgot-password-or-kpostid',
  method: 'POST',
  path: '/v2/profile/forgotPasswordOrKpostID/',
  summary: 'Recover a password or KPost ID by mobile number',
  tags: [...DEVICE_TAGS, 'security', 'otp'],
  // Public recovery entry point — sends an OTP/SMS.
  authentication: { required: false },
  destructive: true,
  sideEffect: 'external',
  otpDependent: 'sends',
  request: body(() => ({ mobileNumber: testData.mobileExists, requestType: 'kpostID' })),
});

export const deactivateAccountApi = defineProfileEndpoint({
  id: 'profile-deactivate-account',
  method: 'POST',
  path: '/v2/profile/deactivateAccount/',
  summary: 'Deactivate the account',
  tags: [...DEVICE_TAGS, 'security', 'critical'],
  /*
   * Disables our own account — the most destructive endpoint in the module, and OTP-gated. `global`
   * and `otpDependent`, so it is doubly blocked on live. Never run for real; the negative probes
   * (off-live) are the only thing that touches it.
   */
  destructive: true,
  sideEffect: 'global',
  otpDependent: 'requires',
  request: body(() => ({ reason: 'QA bench test' })),
});

export const profileDeviceApis = [
  sendPrimaryDeviceOtpApi,
  sendPrimaryOrSecondaryDeviceOtpApi,
  sendDeactivationOtpApi,
  setDevicePrimaryApi,
  updateDevicePrimaryApi,
  setDeviceSecondaryApi,
  updateDeviceSecondaryApi,
  changePasswordApi,
  forgotPasswordOrKpostIdApi,
  deactivateAccountApi,
];
