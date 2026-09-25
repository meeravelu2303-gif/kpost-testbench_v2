import { AUTH_PROFILES } from '@config/auth-profile';
import { expect, test } from '@fixtures';

/**
 * Permanent, UNGATED regression spec — mirrors `kmail`'s `auth-regression.spec.ts` and `katchup`'s
 * `send-regression.spec.ts`. Keeps running every time, specifically to catch and re-file/re-confirm
 * one well-evidenced regression, and turns green automatically the moment the underlying bug is
 * fixed.
 *
 * ## What broke
 *
 * `adminUserLogin`'s own definition (`login.api.ts`) documents a prior, live-verified investigation:
 * BUSINESS_M and BUSINESS_L tiers logged in with 200, BUSINESS_S was correctly (if confusingly)
 * rejected with 403 "Not A Admin". Live-verified again 2026-09-24: ALL THREE tiers now answer
 * `500 {"message":"Unexpected error occurred", ...}` — reproduced twice, back to back, with the
 * SAME `AUTH_PROFILES.kpost.loginRequest(principal)` payload the endpoint's own definition builds by
 * default. This is CRITICAL: every medium/large business admin is locked out of the admin login
 * gateway, not just the small-tier one the tier check intentionally excludes.
 *
 * The endpoint carries no `productionSafe` flag (see the definition), so this spec authorizes its
 * calls with `allowLiveRead`: `destructive: false` + default `sideEffect: 'data'`, and it only ever
 * logs in QA-owned accounts (`business-s`/`business-m`/`business-l` principals) — the same
 * non-destructive shape every other `allowLiveRead` use in this bench already covers.
 *
 * A genuine 5xx from an authorized live call is caught by the engine's own flow-finding pipeline
 * automatically (unlike a 4xx, which is deliberately excluded — see `katchup`'s
 * `send-regression.spec.ts` for that distinction) — no manual `recordBusinessRuleViolation` needed
 * here. Filed as **#598** [KP-A04E2F], CRITICAL, KPost API.
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
