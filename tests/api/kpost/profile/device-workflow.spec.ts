import { expect, test } from '@fixtures';

/**
 * Profile device/security endpoints are refused on live by the production guard: OTP senders,
 * session destroyers and global account changes. Each gets an explicit skip with its reason.
 */

// Ids appear only inside test titles, not as quoted literals, so the coverage audit keeps
// counting these endpoints as not covered.

test.describe(
  'KPost Profile · device/security endpoints (recorded architectural gaps)',
  { tag: ['@api', '@profile', '@regression'] },
  () => {
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
  },
);
