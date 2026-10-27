import { testData } from '@config/test-data.config';
import { pathParamSchema } from '@api/schema/sample-schema';
import { body, pathParams } from '../kpost-endpoint';
import { defineProfileEndpoint } from './profile-endpoint';

/**
 * Device designation and account security. OTP senders are `external`; the actions they gate are
 * `otpDependent`; `changePassword` and `deactivateAccount` are `global` and never cleared for live.
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
  pathParamsSchema: pathParamSchema('requestType'),
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
  // Changes the credential every suite logs in with, so `global`. The documented sample has no
  // `newPassword`.
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
  // This OTP is real, so the probes (each a send) are off; send-free negatives are in
  // forgot-password-limited.spec.ts.
  validations: {
    request: false,
    security: false,
    authentication: false,
    authorization: false,
    concurrency: false,
  },
  request: body(() => ({ mobileNumber: testData.mobileExists, requestType: 'kpostID' })),
});

export const deactivateAccountApi = defineProfileEndpoint({
  id: 'profile-deactivate-account',
  method: 'POST',
  path: '/v2/profile/deactivateAccount/',
  summary: 'Deactivate the account',
  tags: [...DEVICE_TAGS, 'security', 'critical'],
  // Disables our own account: `global` and `otpDependent`, so only off-live negative probes touch
  // it.
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
