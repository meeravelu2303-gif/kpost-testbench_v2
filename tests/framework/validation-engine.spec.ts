import { apiRegistry } from '@api/definitions/index';
import { env } from '@config/env';
import { destructiveBlockReason } from '@engine/production-guard';
import { resolveEndpoint } from '@engine/validation-policy';
import type { Validator } from '@engine/validator';
import { expect, test } from '@fixtures';
import { maskSensitive } from '@utils/masking';
import { validationRegistry } from '@validators/index';

const centralValidatorNames = (validators: Validator[]): string[] =>
  validators
    .map((v) => v.name)
    .filter((name) => !name.startsWith('business-rule.') && !name.startsWith('database.'))
    .sort();

/**
 * Self-tests proving the architecture's guarantees, against the real KPost registry.
 *
 * Nothing here sends a request: every assertion is about what the engine PLANS for an endpoint, so
 * the suite runs anywhere, with no host and no credentials, and still proves the engine is wired.
 */
test.describe('Validation framework', { tag: '@framework' }, () => {
  test('a public endpoint, an authenticated read and a write all receive the same central validators', ({
    validationEngine,
  }) => {
    // The plan honours the run's concurrency switch, so the expectation must too: on a server shared
    // with live the bench runs with CONCURRENCY_PROBES=false and those validators are deliberately
    // absent from every plan.
    const everyValidator = validationRegistry
      .all()
      .filter((v) => env.CONCURRENCY_PROBES || v.category !== 'CONCURRENCY')
      .map((v) => v.name)
      .sort();

    for (const id of [
      'signup-login-kpost-id-exist', // public, no token
      'profile-get-user-profile', // authenticated read
      'katchup-send-message', // authenticated write
    ]) {
      expect(centralValidatorNames(validationEngine.plan(id, 'FULL')), id).toEqual(everyValidator);
    }
  });

  test('database validations stay endpoint-specific', ({ validationEngine }) => {
    const names = (id: string): string[] => validationEngine.plan(id, 'FULL').map((v) => v.name);

    expect(names('katchup-send-message')).toContain('database.katchup-message-persisted');
    expect(names('signup-login-active-session')).toContain('database.kpost-login-session-created');
    // A validation declared on one endpoint never leaks into another's plan.
    expect(names('katchup-send-message')).not.toContain('database.kpost-login-session-created');
    expect(names('profile-get-user-profile').filter((n) => n.startsWith('database.'))).toEqual([]);
  });

  test('a public endpoint resolves as public, a token endpoint as authenticated', () => {
    expect(
      resolveEndpoint(apiRegistry.get('signup-login-kpost-id-exist')).authentication.required,
    ).toBe(false);
    expect(
      resolveEndpoint(apiRegistry.get('profile-get-user-profile')).authentication.required,
    ).toBe(true);
  });

  test('production guard: SMS senders are blocked everywhere, writes need clearance on live', () => {
    /*
     * Literal endpoints, not registry ones, so this tests the rules rather than any one definition's
     * flags. The live-application rules in full (allowlist, OTP, ALLOW_DESTRUCTIVE_TESTS granting
     * nothing) are covered in tests/framework/live-safety.spec.ts.
     */
    const offLive = { isProduction: false, allowDestructive: false };
    const sms = { label: 'POST /x', destructive: true, sideEffect: 'external' as const };

    expect(
      destructiveBlockReason(sms, offLive),
      'a real SMS is blocked even off the live application',
    ).toMatch(/kill-switch/i);
    expect(
      destructiveBlockReason(sms, { ...offLive, allowDestructive: true }),
      'and no flag unlocks it',
    ).toMatch(/kill-switch/i);
    expect(
      destructiveBlockReason({ label: 'POST /x', destructive: true }, offLive),
      'a test-owned data write needs no flag off the live application',
    ).toBeUndefined();
    expect(
      destructiveBlockReason({ label: 'GET /x', destructive: false }, offLive),
      'a read is never blocked',
    ).toBeUndefined();
    expect(
      destructiveBlockReason(
        { label: 'POST /x', destructive: true },
        { isProduction: true, allowDestructive: true },
      ),
      'on live an endpoint without productionSafe is blocked, and ALLOW_DESTRUCTIVE_TESTS grants nothing',
    ).toContain('productionSafe');
  });

  test('secrets and personal data are masked', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl';
    const masked = maskSensitive({
      password: 'hunter2',
      headers: { authorization: `Bearer ${jwt}` },
      note: `token ${jwt} for jane.doe@kpost.test via postgres://app:s3cret@db:5432/kpost`,
    });
    const serialized = JSON.stringify(masked);
    for (const secret of ['hunter2', jwt, 'jane.doe', 's3cret'])
      expect(serialized).not.toContain(secret);
  });
});
