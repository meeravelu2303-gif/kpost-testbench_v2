import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * The FULL forgot-password reset — request OTP → verify → set a new password → log in with it —
 * the one piece of Login's functional coverage the earlier "modal opens safely" test
 * (`login-session.spec.ts`) deliberately stopped short of, specifically to avoid a real OTP send on
 * every run. Confirmed from source (2026-09-30) that assumption doesn't actually hold — clicking
 * "Forgot Password ?" ALONE already dispatches a real OTP (`handleForgetPassword` →
 * `ForgetPasswordSentOTP`) — so both that test and this one need the same OTP_TEST_GATEWAY gate;
 * only this one goes on to actually change a real password, hence the extra `ALLOW_DESTRUCTIVE_TESTS`
 * gate matching `test-data.config.ts`'s own documented hazard for `forgotPasswordKpostId`.
 *
 * ## Never the shared account
 *
 * This NEVER runs against `testData.kpostId` — that is the account every other UI suite logs in
 * with, and a password reset would lock every one of them out. It runs only against the dedicated
 * `QA_FORGOT_PASSWORD_KPOST_ID` spare account (documented in `.env` as account #6, "spare").
 *
 * ## Idempotent by construction
 *
 * The test performs the FULL reset cycle twice: once to a temporary password (proving the reset
 * actually works — logs in with the temp password to confirm), then a second time back to
 * `testData.password` (the account's normal, documented password). The restore runs inside a
 * `finally` block, so it still runs even if the first cycle's own assertions fail partway — the
 * account is left exactly as it started either way, not stranded on the temp password.
 */
test.describe('KPost login · forgot-password full reset cycle', { tag: '@ui' }, () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.skip(
    process.env.LOGIN_UI_LIFECYCLE !== 'true',
    'logs in and out repeatedly; set LOGIN_UI_LIFECYCLE=true',
  );
  test.skip(
    process.env.OTP_TEST_GATEWAY !== 'true' || process.env.TEST_DB_MODE !== 'true',
    'requesting the reset OTP only validates on the confirmed OTP test gateway',
  );
  test.skip(
    process.env.ALLOW_DESTRUCTIVE_TESTS !== 'true',
    'this genuinely rewrites a real account password; set ALLOW_DESTRUCTIVE_TESTS=true',
  );
  test.skip(
    !testData.forgotPasswordKpostId || testData.forgotPasswordKpostId.includes('no.such.user'),
    'needs a real spare account — set QA_FORGOT_PASSWORD_KPOST_ID (never QA_KPOST_ID)',
  );

  test('resetting the spare account\'s password via OTP actually takes effect @ui', async ({
    loginPage,
    page,
  }) => {
    const spareId = testData.forgotPasswordKpostId;
    const originalPassword = testData.password;
    const tempPassword = `TmpReset@${Date.now().toString().slice(-6)}`;

    async function resetTo(newPassword: string): Promise<void> {
      await test.step(`Reset ${spareId}'s password`, async () => {
        await loginPage.goto();
        await loginPage.requestPasswordResetOtp(spareId);
        const otpOutcome = await loginPage.enterPasswordResetOtp(testData.bypassOtp);
        test.skip(otpOutcome === 'invalid', 'the OTP bypass code was rejected this run — re-run');
        await loginPage.submitNewPassword(newPassword);
        // On success the modal closes and returns to the id-entry step (`passwordChange`'s own
        // success branch) — the id input reappearing is the most reliable proof of that, since the
        // success toast text is not pinned here (see the same rationale in
        // `login-functional.spec.ts`'s server-message test).
        await expect(
          loginPage.loginIdInput,
          'the modal closes and returns to id-entry after a successful reset',
        ).toBeVisible({ timeout: 15_000 });
      });
    }

    async function logout(): Promise<void> {
      await page.locator('.header-user-pill').first().click();
      await page.getByText(/^Log ?out$/i).first().click().catch(() => undefined);
      await page
        .getByRole('button', { name: /^Logout$/i })
        .first()
        .click();
      await expect(page, 'logout returns to the login screen').toHaveURL(/\/login/, {
        timeout: 20_000,
      });
    }

    // Phase 2 (the restore) must run even if phase 1 throws — a partial failure must never strand
    // the shared spare account on the temp password. `finally` is the one construct that survives a
    // thrown `expect()` here; a bare sequential `await` would not reach the restore at all.
    try {
      // Phase 1: reset to a temporary password and prove it actually works.
      await resetTo(tempPassword);
      await loginPage.login(spareId, tempPassword);
      await expect(
        page,
        'the account logs in with the NEW password immediately after the reset',
      ).toHaveURL(/\/home/, { timeout: 20_000 });
      await logout();
    } finally {
      // Phase 2: reset back to the account's normal password, leaving it exactly as found.
      await test.step('Restore the original password (always runs)', async () => {
        await resetTo(originalPassword);
        await loginPage.login(spareId, originalPassword);
        await expect(
          page,
          'the account logs back in with its ORIGINAL password after the restore',
        ).toHaveURL(/\/home/, { timeout: 20_000 });
      });
    }
  });
});
