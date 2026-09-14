import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * The login **screen** on the live front end — the two-step KPOST flow, across all browsers.
 *
 * Modelled on `src/components/auth/Login.js` (KPOST_REACTJS_2023_V1). The component ships no
 * `data-testid` hooks, so assertions target **stable states** (which step is shown, which URL),
 * not transient toasts.
 *
 * ## One navigation, not four
 *
 * Loading `/login` fetches the country list from an endpoint that **rate-limits after repeated fresh
 * loads** — and each separate test navigates fresh, so a suite of four login tests exhausts the
 * limit and the later ones cannot even render the form (worst in the slower engines). So the screen
 * behaviours are checked in a **single test with one navigation**, walking the real flow: unknown id
 * does not advance → a valid id advances → a wrong password is rejected. That both mirrors a real
 * session and keeps the suite reliable in Chromium, Firefox and WebKit.
 */
test.describe('KPost login screen', { tag: '@ui' }, () => {
  // Log OUT: the login screen must be tested from a fresh session, not the one `setup` saved.
  test.use({ storageState: { cookies: [], origins: [] } });

  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  test('the two-step flow rejects the unknown, advances the valid, and refuses a bad password @ui', async ({
    loginPage,
    page,
  }) => {
    await loginPage.goto();

    // 0) An EMPTY id must not advance — the form validates the required field.
    await loginPage.enterLoginId('');
    await expect(
      loginPage.passwordInput,
      'an empty id does not reach the password step',
    ).toBeHidden();

    // 1) An unknown KPOST ID must NOT advance to the password step.
    await loginPage.enterLoginId(testData.kpostIdAbsent);
    await expect(
      loginPage.passwordInput,
      'an unknown id does not reach the password step',
    ).toBeHidden();

    // 2) A valid id advances to the password step (fetchUserDetails resolves). Step 1 is still
    //    active after the unknown id, so re-enter without a fresh navigation.
    await loginPage.enterLoginId(testData.kpostId);
    await expect(loginPage.passwordInput, 'a valid id advances to the password').toBeVisible({
      timeout: 20_000,
    });

    // 3) A wrong password is rejected: inline error, and we never leave /login.
    await loginPage.passwordInput.fill('DefinitelyNotMyPassword!9f2a');
    await expect(loginPage.loginButton).toBeEnabled();
    await loginPage.loginButton.click();
    await expect(loginPage.inlineError, 'a wrong password shows the inline error').toBeVisible({
      timeout: 15_000,
    });
    await expect(page, 'a wrong password must not log in').toHaveURL(/\/login/);
  });

  /*
   * That a CORRECT login reaches /home is proven by the `setup` project (it logs in with this same
   * account through this same page object before every browser run), so it is not duplicated here.
   */
});
