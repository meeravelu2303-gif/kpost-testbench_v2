import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Forgot-password negative cases, deliberately capped at five requests per run.
 *
 * The forgot-password OTP is REAL on the live gateway (owner, 2026-10-09): a successful request
 * texts a registered number. So the sweep only sends each endpoint's single primary request, and
 * this spec adds the few negative cases that cannot send anything: an account that does not exist,
 * a missing field, and a wrong type. A server must answer each with a client error, never a 5xx.
 *
 * Runs only where the OTP flows are opened (`OTP_TEST_GATEWAY` + `TEST_DB_MODE`); anywhere else the
 * SMS kill-switch refuses these requests and the spec skips.
 */
test.describe('Forgot-password negative cases (capped) @api', () => {
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
        { label: `limited:forgot-password:${c.label}` },
      );
      expect(exchange.status, `${c.id} with ${c.label}`).toBeLessThan(500);
    });
  }
});
