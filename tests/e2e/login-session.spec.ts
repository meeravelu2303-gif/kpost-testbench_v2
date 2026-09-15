import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Login & session — the deeper screen behaviours beyond the two-step credential flow
 * (`login.spec.ts` covers empty/unknown/valid id + wrong password in one navigation).
 *
 * Split by the session they need:
 *  - **logged out** (`storageState` cleared): the Forgot-Password modal, the Sign-Up link, and the
 *    session-expiry redirect — all read-only and safe (the Forgot-Password OTP is NOT requested, so no
 *    real SMS is sent; the test asserts the modal opens and stops).
 *  - **authenticated** (the shared `setup` session): logout.
 *
 * Selectors are from `src/components/auth/Login.js`: heading "Sign in to your account", the id field
 * `#username` (placeholder "Enter KPOST ID / Mobile number"), "Submit", "Forgot Password ?", "Sign Up",
 * and the Forgot-Password modal (title "Forgot Password", six OTP inputs).
 */

test.describe('KPost login screen · deeper flows', { tag: '@ui' }, () => {
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

    await page
      .getByText(/Forgot Password/i)
      .first()
      .click();

    // The reset modal opens with its title. We STOP here — submitting would send a real OTP SMS.
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
 * Logout — from the authenticated (shared) session. It ends only THIS browser context's session (the
 * saved `storageState` file is untouched, so other tests still log in), and it is the last thing this
 * test does. The header logout triggers a native `window.confirm`, which we auto-accept.
 *
 * FIRST-RUN NOTE: the header logout trigger (the user chip → logout control) needs one live recording
 * pass — `containers/Header.js` opens logout via a menu whose exact target is not stable in source.
 * Gated behind `LOGIN_UI_LIFECYCLE=true` so it never disrupts a default run until tuned.
 */
test.describe('KPost header · logout', { tag: '@ui' }, () => {
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

    // The logout confirm is a native dialog — auto-accept it.
    page.on('dialog', (dialog) => dialog.accept().catch(() => undefined));

    // Open the header user chip, then the logout control.
    await page.locator('.header-user-pill').first().click();
    await page
      .getByText(/^Log ?out$/i)
      .first()
      .click();

    await expect(page, 'logout returns to the login screen').toHaveURL(/\/login/, {
      timeout: 20_000,
    });
  });
});
