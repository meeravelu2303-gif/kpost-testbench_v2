import { ProductionSafetyError } from '@engine/production-guard';
import { expect, test } from '@fixtures';

/**
 * Logout-all-devices (ends the owner's own sessions) and setAccessCode (rewrites a credential) are
 * `sideEffect: 'global'` and can never run here, so this proves the production guard refuses them.
 */
test.describe(
  'KPost signup-login · permanently-walled endpoints @api @signup-login',
  {
    tag: ['@api', '@auth', '@regression'],
    annotation: [{ type: 'non-functional', description: 'resilience' }],
  },
  () => {
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
  },
);
