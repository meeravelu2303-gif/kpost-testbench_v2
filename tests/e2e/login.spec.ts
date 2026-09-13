import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * The login **screen** on the live front end — the two-step KPOST flow.
 *
 * Modelled on `src/components/auth/Login.js` (KPOST_REACTJS_2023_V1). The component ships no
 * `data-testid` hooks and the app is a heavy live SPA, so assertions target **stable states** (which
 * step is shown, which URL) rather than transient toasts, which auto-dismiss and race the test.
 *
 * These log in from scratch, so they run in a fresh logged-out context (not the session `setup`
 * saved), and only when a real account is configured. `@ui` tests get a retry (see the config).
 */
test.describe('KPost login screen', { tag: '@ui' }, () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  test('an unknown KPOST ID does not advance to the password step @ui', async ({
    loginPage,
    page,
  }) => {
    await loginPage.goto();
    await loginPage.enterLoginId(testData.kpostIdAbsent);

    // A real account advances to the password field; an unknown one must not. Asserting the stable
    // absence of step 2 is reliable where catching the "doesn't exist" toast is not.
    await expect(page.locator('input[type="password"]')).toBeHidden();
  });

  test('a valid id advances to the password step @ui', async ({ loginPage }) => {
    await loginPage.goto();
    await loginPage.enterLoginId(testData.kpostId);

    await expect(loginPage.passwordInput).toBeVisible({ timeout: 20_000 });
    await expect(loginPage.loginButton).toBeVisible();
  });

  test('a wrong password keeps the user on the login screen @ui', async ({ loginPage, page }) => {
    await loginPage.login(testData.kpostId, 'DefinitelyNotMyPassword!9f2a');

    // The stable signal of rejection: the inline error appears and we never leave /login.
    await expect(loginPage.inlineError, 'a wrong password shows the inline error').toBeVisible({
      timeout: 15_000,
    });
    await expect(page, 'a wrong password must not log in').toHaveURL(/\/login/);
  });

  /*
   * That a CORRECT login reaches /home is proven by the `setup` project (it logs in with this same
   * account before every browser run), so it is not duplicated here — repeating a full fresh-context
   * login just throttles the country-load endpoint and adds flake for no extra coverage.
   */
});
