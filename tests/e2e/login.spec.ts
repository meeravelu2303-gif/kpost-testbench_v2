import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * The login **screen** — the two-step KPOST flow, on the live front end.
 *
 * These drive the real UI (`/login`), which the API tests cannot reach: the country + KPOST ID
 * step, the name card, the password step, the landing on `/home`, and header logout back to
 * `/login`. Modelled on `src/components/auth/Login.js`; see `src/pages/LoginPage.ts`.
 *
 * Live-safety: our own two PERSONAL accounts only, and the wrong-password case makes exactly one
 * attempt (the API suite covers lockout follow-up; the screen only needs to show the error).
 * These run only when a browser project is selected AND real credentials are set — otherwise the
 * `setup` project has saved an anonymous state and there is nothing to log into.
 */
test.describe('KPost login screen', { tag: '@ui' }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  test('unknown KPOST ID is rejected at step 1 @ui', async ({ loginPage, page }) => {
    await loginPage.goto();
    await loginPage.enterLoginId(testData.kpostIdAbsent);

    // The app raises a toast and does NOT advance to the password step.
    await expect(page.getByText(/doesn't exist/i)).toBeVisible();
    await expect(loginPage.passwordInput).toBeHidden();
  });

  test('a valid id advances to the password step @ui', async ({ loginPage }) => {
    await loginPage.goto();
    await loginPage.enterLoginId(testData.kpostId);

    // Step 2 appears: the password field and the Login button.
    await expect(loginPage.passwordInput).toBeVisible();
    await expect(loginPage.loginButton).toBeVisible();
  });

  test('a wrong password shows an inline error, not a page crash @ui', async ({
    loginPage,
    page,
  }) => {
    await loginPage.login(testData.kpostId, 'DefinitelyNotMyPassword!9f2a');

    // Stay on /login with the server's message shown inline; no navigation to /home.
    await expect(loginPage.inlineError).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('a correct login lands on /home and logout returns to /login @ui', async ({
    loginPage,
    page,
  }) => {
    await loginPage.login(testData.kpostId, testData.password);

    await expect(page, 'a successful login leaves the login screen').toHaveURL(/\/home/);

    /*
     * Log out through the header avatar menu -> Logout item -> confirm in the modal. The component
     * ships no test-ids, so these are structural locators from Header.js: the avatar pill opens the
     * menu, the menu's Logout item opens a confirm modal, and the modal's Logout button submits.
     * A deterministic three-step sequence, not a try/other-way fallback — if the header markup
     * changes this fails here with a clear locator, which is what a UI test should do.
     */
    await page.locator('.header-user-pill').click();
    await page
      .getByText(/^Logout$/)
      .first()
      .click();
    await page.getByRole('button', { name: /^Logout$/ }).click();

    await expect(page, 'logout returns to the login screen').toHaveURL(/\/login/);
  });
});
