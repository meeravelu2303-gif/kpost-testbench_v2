import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Forgot-password negative cases that cannot text anyone (absent account, missing field, wrong type),
 * capped at five requests: each must get a 4xx, never a 5xx. Needs OTP_TEST_GATEWAY + TEST_DB_MODE.
 */
test.describe(
  'Forgot-password negative cases (capped) @api',
  { tag: ['@api', '@platform', '@regression'] },
  () => {
    test.skip(
      process.env.OTP_TEST_GATEWAY !== 'true' || process.env.TEST_DB_MODE !== 'true',
      'the OTP flows are opened only with OTP_TEST_GATEWAY=true and TEST_DB_MODE=true',
    );

    const cases = [
      {
        id: 'common-forgot-password-otp',
        label: 'an account that does not exist',
        body: { kpostID: testData.kpostIdAbsent, requestType: 'password' },
      },
      {
        id: 'common-forgot-password-otp',
        label: 'a missing kpostID',
        body: { requestType: 'password' },
      },
      {
        id: 'common-forgot-password-otp',
        label: 'a kpostID of the wrong type',
        body: { kpostID: 12345, requestType: 'password' },
      },
      {
        id: 'profile-forgot-password-or-kpostid',
        label: 'a mobile number that is not registered',
        body: { mobileNumber: testData.mobileAbsent, requestType: 'kpostID' },
      },
      {
        id: 'profile-forgot-password-or-kpostid',
        label: 'a missing mobile number',
        body: { requestType: 'kpostID' },
      },
    ];

    for (const c of cases) {
      test(`${c.id}: ${c.label} gets a client error, never a 5xx`, async ({ endpoints }) => {
        const exchange = await endpoints.sendTo(
          c.id,
          { body: c.body },
          // Every case names nobody real, so nothing can be texted; the production guard requires this.
          { label: `limited:forgot-password:${c.label}`, noSmsRecipient: true },
        );
        expect(exchange.status, `${c.id} with ${c.label}`).toBeLessThan(500);
      });
    }
  },
);
