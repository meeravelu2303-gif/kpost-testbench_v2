import { AUTH_PROFILES } from '@config/auth-profile';
import { expect, test } from '@fixtures';

/**
 * Ungated regression check: adminUserLogin must not 500 for any business tier (M/L log in, S gets a
 * 4xx). Known defect #598. A 5xx is picked up by the engine's flow-finding pipeline automatically.
 */
test.describe('KPost signup-login · admin-login regression @api @kpost-api @signup-login', () => {
  for (const key of ['business-s', 'business-m', 'business-l'] as const) {
    test(`adminUserLogin must not 500 for a real ${key} admin`, async ({ endpoints }) => {
      const principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === key)!;
      const exchange = await endpoints.sendTo(
        'signup-login-admin-user-login',
        { body: AUTH_PROFILES.kpost.loginRequest(principal) },
        { label: `admin-login-regression:${key}`, allowLiveRead: true },
      );
      expect(
        exchange.status,
        `adminUserLogin answered ${exchange.status} for a real ${key} admin ` +
          `(body: ${exchange.bodyText.slice(0, 300)}) — should be 200 (M/L) or a real 4xx tier ` +
          'rejection (S), never a 500',
      ).toBeLessThan(500);
    });
  }
});
