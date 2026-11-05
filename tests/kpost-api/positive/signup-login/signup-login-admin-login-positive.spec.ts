import { AUTH_PROFILES } from '@config/auth-profile';
import { expect, test } from '@fixtures';

/**
 * Ungated regression check: adminUserLogin must not 500 for any business tier (M/L log in, S gets a
 * 4xx). Known defect #598. A 5xx is picked up by the engine's flow-finding pipeline automatically.
 */
test.describe(
  'KPost signup-login · admin-login regression @api @kpost-api @signup-login',
  { tag: ['@auth', '@regression'] },
  () => {
    for (const key of ['business-s', 'business-m', 'business-l'] as const) {
      test(`adminUserLogin must not 500 for a real ${key} admin`, async ({ endpoints }) => {
        const principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === key)!;
        // `loginRequest` is already the request ({ body }); wrapping it again sent `{ body: { … } }`,
        // which the server rightly refused as "kpostID is required" (fixed 2026-11-05).
        const exchange = await endpoints.sendTo(
          'signup-login-admin-user-login',
          AUTH_PROFILES.kpost.loginRequest(principal),
          { label: `admin-login-regression:${key}`, allowLiveRead: true },
        );
        const answer = `${exchange.status} ${exchange.bodyText.slice(0, 300)}`;
        // No HTTP answer (status 0) is "not re-checked", never a pass: `< 500` used to let it through.
        test.skip(
          exchange.status === 0,
          `no HTTP answer from adminUserLogin for ${key} (${exchange.transportError?.message ?? 'transport error'}): not re-checked`,
        );
        expect(
          exchange.status,
          `adminUserLogin for a real ${key} admin must never 500 (${answer})`,
        ).toBeLessThan(500);
        // Medium and large companies' admins sign in; the small tier is refused with a clean 4xx.
        if (key !== 'business-s')
          expect.soft(exchange.status, `a real ${key} admin signs in (${answer})`).toBe(200);
      });
    }
  },
);
