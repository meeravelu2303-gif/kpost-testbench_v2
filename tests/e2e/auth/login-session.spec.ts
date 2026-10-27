import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { answerForgotPasswordSmsLocally } from '../support/no-real-sms';

/**
 * Login screen extras: session-expiry redirect, Forgot Password modal (SMS answered in the browser),
 * the Sign Up link, and header logout (gated on LOGIN_UI_LIFECYCLE).
 */

test.describe('KPost login screen · deeper flows', { tag: ['@ui', '@auth', '@regression'] }, () => {
  // These run from a FRESH (logged-out) session, not the one `setup` saved.
  test.use({ storageState: { cookies: [], origins: [] } });

  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  test('an expired / absent session is redirected from an authenticated route to /login @ui', async ({
    page,
  }) => {
    // With no stored token, an authenticated route must bounce to the login screen — the session guard.
    await page.goto('/katchup', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await expect(page, 'an unauthenticated user is sent to /login').toHaveURL(/\/login/, {
      timeout: 20_000,
    });
  });

  test('the Forgot Password link opens the reset modal (no OTP requested — safe) @ui', async ({
    loginPage,
    page,
  }) => {
    await loginPage.goto();

    // The "Forgot Password ?" link is on the password step, so advance a valid id first.
    await loginPage.enterLoginId(testData.kpostId);
    await expect(loginPage.passwordInput, 'a valid id advances to the password').toBeVisible({
      timeout: 20_000,
    });

    // Clicking the link ALONE sends a real SMS (Login.js handleForgetPassword); answer it in the
    // browser instead — the one forgot-password SMS per run belongs to the lifecycle spec.
    await answerForgotPasswordSmsLocally(page);
    await page
      .getByText(/Forgot Password/i)
      .first()
      .click();

    // The reset modal opens with its title. We STOP here (the full reset is the lifecycle spec).
    await expect(
      page.getByText(/^Forgot Password$/i).first(),
      'the Forgot Password modal opens',
    ).toBeVisible({ timeout: 15_000 });
  });

  test('the Sign Up link leaves the login screen for registration @ui', async ({
    loginPage,
    page,
  }) => {
    await loginPage.goto();
    await page
      .getByText(/^Sign Up$/i)
      .first()
      .click();
    await expect(page, 'Sign Up leaves /login for the signup screen').not.toHaveURL(/\/login$/, {
      timeout: 15_000,
    });
  });
});

/**
 * Logout from the shared session. Gated on LOGIN_UI_LIFECYCLE because it ends the session; the saved
 * storageState file is untouched.
 */
test.describe('KPost header · logout', { tag: ['@ui', '@auth', '@regression'] }, () => {
  test.skip(
    process.env.LOGIN_UI_LIFECYCLE !== 'true',
    'ends the session; set LOGIN_UI_LIFECYCLE=true',
  );
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  test('logging out from the header returns to /login @ui', async ({ page }) => {
    await page.goto('/home', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page
      .locator('.loader-overlay')
      .waitFor({ state: 'hidden', timeout: 30_000 })
      .catch(() => undefined);

    // User chip → Logout menu item → in-page confirm modal with a Logout button.
    await page.locator('.header-user-pill').first().click();
    await page
      .getByText(/^Log ?out$/i)
      .first()
      .click()
      .catch(() => undefined);

    // Confirm in the modal.
    await expect(
      page.getByText(/Are you sure you want to logout/i).first(),
      'the logout confirm modal appears',
    ).toBeVisible({ timeout: 15_000 });
    await page
      .getByRole('button', { name: /^Logout$/i })
      .first()
      .click();

    await expect(page, 'logout returns to the login screen').toHaveURL(/\/login/, {
      timeout: 20_000,
    });
  });
});
