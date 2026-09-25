import { expect, test } from '@fixtures';

/**
 * Signup-login **recorded gaps — not workarounds**.
 *
 *   - `signup-login-admin-registration`: `otpDependent: 'requires'` + `sideEffect: 'global'` —
 *     creates a whole company/tenant per call, which "cannot be released" (the endpoint's own
 *     definition). Unlike the personal `signup-login-signup` (already exercised live in
 *     `otp-signup-lifecycle.spec.ts`), there is no dedicated reserved identity for a business-tier
 *     signup — only one `signupKpostId`/`signupMobile` pair exists, already consumed by the personal
 *     signup test. Reusing it here risks colliding with that test (a company registered on the same
 *     identity a personal account already claimed) and, on a fresh DB, would permanently mint a
 *     company/tenant no later run can undo. Needs its own `QA_BUSINESS_SIGNUP_*` identity before
 *     this can be exercised, the same reasoning `otp-signup-lifecycle.spec.ts` already applies to
 *     `forgotPasswordKpostId`.
 *   - `signup-login-logout-all-devices`: `sideEffect: 'global'` — ends EVERY session of the account,
 *     including the owner's own manual sessions in a browser or the mobile app. The endpoint's own
 *     definition already declines this for exactly that reason; `signup-login-user-logout` (a single
 *     session, scoped to a session this bench opened) already proves the underlying FR-S12 logout
 *     behaviour in `login-flow.spec.ts` without that collateral.
 *   - `signup-login-set-access-code`: `sideEffect: 'global'` — rewrites a credential
 *     (`currentPassword` + `accessCode`) on a real account. The endpoint's own definition already
 *     declines this: a caller who could set an access code without proving ownership first would be
 *     a real vulnerability, but exercising the happy path here means overwriting a live account's
 *     access code, which nothing in this bench can safely undo afterward.
 */

test.describe('KPost signup-login · recorded gaps', () => {
  test('signup-login-admin-registration: no live test (global, OTP-dependent — creates an unreleasable company tenant, no reserved identity)', () => {
    test.skip(
      true,
      'no QA_BUSINESS_SIGNUP_* identity is configured; the only signup identity available ' +
        '(signupKpostId/signupMobile) is already consumed by the personal signup test, and a ' +
        'business registration on it would either collide or mint a permanent company/tenant. ' +
        'Needs a dedicated reserved identity before this can run live, same reasoning as ' +
        'forgotPasswordKpostId in otp-signup-lifecycle.spec.ts.',
    );
    expect(true, 'placeholder — this test body never runs past test.skip above').toBe(true);
  });

  test("signup-login-logout-all-devices: no live test (global — ends every session of the account, including the owner's own)", () => {
    test.skip(
      true,
      "sideEffect:'global'; the endpoint's own definition declines this for exactly that reason. " +
        'signup-login-user-logout already proves FR-S12 (login-flow.spec.ts) on a session this ' +
        'bench opened itself, without ending sessions it does not own.',
    );
    expect(true, 'placeholder — this test body never runs past test.skip above').toBe(true);
  });

  test('signup-login-set-access-code: no live test (global — rewrites a real credential with no way to restore it)', () => {
    test.skip(
      true,
      "sideEffect:'global'; the endpoint's own definition declines this. Exercising the happy path " +
        "would overwrite a live account's access code — there is no safe target to rewrite and " +
        'restore, unlike the forgot-password flow which resets to the known QA_PASSWORD.',
    );
    expect(true, 'placeholder — this test body never runs past test.skip above').toBe(true);
  });
});
