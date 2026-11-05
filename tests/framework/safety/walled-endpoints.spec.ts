import { apiRegistry } from '@api/definitions/index';
import { destructiveBlockReason, type SafetyFlags } from '@engine/production-guard';
import { resolveEndpoint } from '@engine/validation-policy';
import { expect, test } from '@fixtures';

/**
 * Endpoints the bench must never send on a shared QA account, whatever a run's flags say: OTP senders
 * that text a real phone, calls that end the running session, and credential or account changes that
 * would lock the suite out. Each is refused by the production guard in a product run (the flags of
 * `npm run product:kpost-api`), and still refused when a flow opts in to a live write. No request is
 * sent: the guard is asked directly. (Replaces the skip-only placeholders of 2026-11-05.)
 */
const PRODUCT_RUN: SafetyFlags = {
  isProduction: true,
  allowDestructive: true,
  writeFuzz: true,
  testDbMode: true,
  otpTestGateway: true,
  globalLifecycle: true,
  liveHostConfigured: false,
};

const WALLED: Readonly<Record<string, string>> = {
  'profile-send-primary-device-otp': 'texts the account’s real phone (ignores the OTP bypass)',
  'profile-send-device-otp': 'texts the account’s real phone (ignores the OTP bypass)',
  'profile-send-deactivation-otp': 'texts the account’s real phone (ignores the OTP bypass)',
  'profile-forgot-password-or-kpostid': 'texts a real phone on every host',
  'profile-set-device-primary': 'ends the running session',
  'profile-update-device-primary': 'ends the running session',
  'profile-set-device-secondary': 're-designates the shared account’s device',
  'profile-update-device-secondary': 're-designates the shared account’s device',
  'profile-change-password': 'changes a shared account’s password (would lock the suite out)',
  'profile-deactivate-account': 'disables the account',
  'signup-login-logout-all-devices': 'ends every session of the account',
  'signup-login-set-access-code': 'rewrites a credential',
};

test.describe('walled endpoints are refused by the production guard @framework', () => {
  for (const [id, why] of Object.entries(WALLED)) {
    test(`${id} is refused: it ${why}`, () => {
      const endpoint = resolveEndpoint(apiRegistry.get(id));
      expect(destructiveBlockReason(endpoint, PRODUCT_RUN), 'in a product run').toBeDefined();
      expect(
        destructiveBlockReason(endpoint, { ...PRODUCT_RUN, allowLiveWrite: true }),
        'even when a flow opts in to a live write',
      ).toBeDefined();
    });
  }
});
