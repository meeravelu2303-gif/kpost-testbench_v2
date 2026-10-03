import { ProductionSafetyError } from '@engine/production-guard';
import { expect, test } from '@fixtures';

/**
 * `signup-login-logout-all-devices` and `signup-login-set-access-code` are the two signup-login
 * endpoints with no live happy-path test — both `sideEffect: 'global'`, which `production-guard.ts`
 * refuses unconditionally on this environment (no flag, including `ALLOW_DESTRUCTIVE_TESTS`, unlocks
 * it — see the guard's own doc comment). There is no non-production KPost environment to exercise
 * them against, so that is a genuine, permanent architectural wall, not a bench gap to close.
 *
 * What CAN be verified, and is below: that the guard itself actually refuses them, rather than
 * leaving that as an assumption. A silent `test.skip` cannot tell "correctly walled off" apart from
 * "nobody ever tried" — this makes the control itself the thing under test.
 *
 *   - `signup-login-logout-all-devices` would end EVERY session of the account, including the
 *     owner's own manual sessions in a browser or the mobile app. `signup-login-user-logout` already
 *     proves the underlying FR-S12 logout behaviour (`login-flow.spec.ts`) on a session this bench
 *     opened itself, without that collateral.
 *   - `signup-login-set-access-code` would rewrite a real credential (`currentPassword` +
 *     `accessCode`) with no safe way to restore it afterward — unlike the forgot-password flow,
 *     which resets to the known `QA_PASSWORD`.
 */
test.describe('KPost signup-login · permanently-walled endpoints @api @signup-login', () => {
  test('signup-login-logout-all-devices is refused by the production guard, not merely untested', async ({
    endpoints,
  }) => {
    await expect(
      endpoints.sendTo(
        'signup-login-logout-all-devices',
        {},
        { label: 'gaps:logout-all-devices', allowLiveWrite: true },
      ),
    ).rejects.toThrow(ProductionSafetyError);
  });

  test('signup-login-set-access-code is refused by the production guard, not merely untested', async ({
    endpoints,
  }) => {
    await expect(
      endpoints.sendTo(
        'signup-login-set-access-code',
        {},
        { label: 'gaps:set-access-code', allowLiveWrite: true },
      ),
    ).rejects.toThrow(ProductionSafetyError);
  });
});
