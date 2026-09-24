import { expect, test } from '@fixtures';

/**
 * Profile **device/security endpoints — architecturally excluded from live testing, by design**.
 *
 * Every endpoint in `device.api.ts` falls into one of three categories the bench's own safety
 * design (`src/validation-engine/production-guard.ts`) refuses on live, unconditionally:
 *
 *   - **OTP senders** (`sideEffect: 'external'`, `otpDependent: 'sends'`) — deliver a real SMS/
 *     email. Blocked by the kill-switch in every mode; only a confirmed OTP test gateway
 *     (`OTP_TEST_GATEWAY` + `TEST_DB_MODE`) opens them, and this bench has neither configured.
 *   - **Session-destroyers** (`setDeviceAs*`, `updateDeviceAs*`, `deactivateAccount`) — named
 *     explicitly in the guard's `isSessionDestroyer` pattern, which stays blocked EVEN on a
 *     confirmed OTP test gateway: running them would displace or disable the account every other
 *     test in the suite logs in with.
 *   - **Global credential/account changes** (`changePassword`, `deactivateAccount`) —
 *     `sideEffect: 'global'`, never cleared for live regardless of any flag.
 *
 * This is not a coverage gap to close — it is the framework correctly refusing to let an automated
 * run text a real phone, lock the QA account out mid-suite, or disable it. Recorded here as
 * explicit, individually-reasoned skips (Phase 1's "don't leave a gap silent") rather than folded
 * into a single blanket note, so each endpoint's specific block reason is traceable.
 */

// Ids deliberately NOT collected into an array of string literals: this file's coverage-depth
// audit counts an endpoint id as "addressed" when its exact quoted literal appears anywhere in a
// rich test file, and these are recorded gaps, not real business-rule tests — each id is embedded
// only inside its own test title (a template literal, not a standalone quoted match) so the audit
// keeps counting them honestly as not-yet-covered.

test.describe('KPost Profile · device/security endpoints (recorded architectural gaps)', () => {
  test('profile-send-primary-device-otp: no live test (sends a real OTP/SMS/email — SMS kill-switch)', () => {
    test.skip(
      true,
      "sendPrimaryDeviceOtp is otpDependent:'sends' with sideEffect:'external' — the SMS/OTP " +
        'kill-switch in destructiveBlockReason() refuses it against any real host in every mode. ' +
        'Only a confirmed OTP test gateway (OTP_TEST_GATEWAY + TEST_DB_MODE, neither configured ' +
        'here) would open it. Not worked around: sending a real OTP on a normal run would cost ' +
        'money and exhaust the SMS gateway.',
    );
    expect(true, 'placeholder — this test body never runs past test.skip above').toBe(true);
  });

  test('profile-send-device-otp: no live test (sends a real OTP/SMS/email — SMS kill-switch)', () => {
    test.skip(
      true,
      "sendPrimaryOrSecondaryDeviceOtp is otpDependent:'sends' with sideEffect:'external' — same " +
        'SMS/OTP kill-switch as sendPrimaryDeviceOtp above.',
    );
    expect(true, 'placeholder — this test body never runs past test.skip above').toBe(true);
  });

  test('profile-send-deactivation-otp: no live test (sends a real OTP/SMS/email — SMS kill-switch)', () => {
    test.skip(
      true,
      "sendAccountDeactivationOtp is otpDependent:'sends' with sideEffect:'external' — same SMS/OTP " +
        'kill-switch, and it is the OTP step of the account-deactivation flow, which stays blocked ' +
        'in its own right below regardless.',
    );
    expect(true, 'placeholder — this test body never runs past test.skip above').toBe(true);
  });

  test('profile-forgot-password-or-kpostid: no live test (sends a real OTP/SMS/email — SMS kill-switch)', () => {
    test.skip(
      true,
      "forgotPasswordOrKpostID is otpDependent:'sends' with sideEffect:'external' — a public " +
        '(unauthenticated) recovery entry point that sends a real OTP; same kill-switch as the ' +
        'others above.',
    );
    expect(true, 'placeholder — this test body never runs past test.skip above').toBe(true);
  });

  test('profile-set-device-primary: no live test (session-destroyer, blocked even on an OTP test gateway)', () => {
    test.skip(
      true,
      "setDeviceAsPrimary is otpDependent:'requires' AND matches the guard's isSessionDestroyer " +
        'pattern — blocked even when OTP_TEST_GATEWAY+TEST_DB_MODE are both set, specifically ' +
        'because it would displace the primary device of the account every other test in the suite ' +
        'is logged in as, breaking every later test in the run. Not worked around: there is no safe ' +
        "way to exercise this against the suite's own live session.",
    );
    expect(true, 'placeholder — this test body never runs past test.skip above').toBe(true);
  });

  test('profile-update-device-primary: no live test (session-destroyer, blocked even on an OTP test gateway)', () => {
    test.skip(
      true,
      'updateDeviceAsPrimary matches the same isSessionDestroyer pattern as setDeviceAsPrimary ' +
        'above, for the same reason.',
    );
    expect(true, 'placeholder — this test body never runs past test.skip above').toBe(true);
  });

  test('profile-set-device-secondary: no live test (session-destroyer, blocked even on an OTP test gateway)', () => {
    test.skip(
      true,
      'setDeviceAsSecondary matches the isSessionDestroyer pattern (updateDeviceAs*/setDeviceAs*) ' +
        'for the same reason as the primary-device pair above.',
    );
    expect(true, 'placeholder — this test body never runs past test.skip above').toBe(true);
  });

  test('profile-update-device-secondary: no live test (session-destroyer, blocked even on an OTP test gateway)', () => {
    test.skip(
      true,
      'updateDeviceAsSecondary matches the isSessionDestroyer pattern for the same reason as the ' +
        'others above.',
    );
    expect(true, 'placeholder — this test body never runs past test.skip above').toBe(true);
  });

  test('profile-change-password: no live test (global credential change — would lock the suite out)', () => {
    test.skip(
      true,
      "changePassword is sideEffect:'global', never cleared for live under any flag. Running it " +
        'would change the credential every other suite/test logs in with mid-run — a self-inflicted ' +
        'lockout, not a defect to find. The documented sample is also missing a distinct newPassword ' +
        'field from confirmPassword, which the null/required negative probes already exercise off-live.',
    );
    expect(true, 'placeholder — this test body never runs past test.skip above').toBe(true);
  });

  test('profile-deactivate-account: no live test (the most destructive endpoint in the module — disables our own account)', () => {
    test.skip(
      true,
      "deactivateAccount is sideEffect:'global' AND otpDependent:'requires' — doubly blocked on " +
        'live. Disabling the QA account mid-suite would take every other test down with it. Never ' +
        'run for real; only the off-live negative probes touch it.',
    );
    expect(true, 'placeholder — this test body never runs past test.skip above').toBe(true);
  });
});
