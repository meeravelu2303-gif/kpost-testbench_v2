import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * The two-step login screen. One test with one navigation, because loading /login fetches a country
 * list that rate-limits after repeated fresh loads.
 */
test.describe('KPost login screen', { tag: ['@ui', '@auth', '@regression'] }, () => {
  // Log OUT: the login screen must be tested from a fresh session, not the one `setup` saved.
  test.use({ storageState: { cookies: [], origins: [] } });

  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  test(
    'the two-step flow rejects the unknown, advances the valid, and refuses a bad password @ui',
    { annotation: [{ type: 'requirement', description: 'FR-SL-025' }] },
    async ({ loginPage, page, endpoints }) => {
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

      // FR-SL-025: the password step shows the account's name (from fetchUserDetails) and the typed id.
      const details = await endpoints.sendTo(
        'signup-login-fetch-user-details',
        { body: { kpostID: testData.kpostId, countryID: testData.countryId } },
        { label: 'login:identity' },
      );
      const parsed = details.json();
      const who = ((parsed.ok ? (parsed.value as { data?: unknown }).data : {}) ?? {}) as {
        firstName?: string;
        lastName?: string;
      };
      const expectedName = `${who.firstName ?? ''} ${who.lastName ?? ''}`.trim();
      expect(expectedName, 'the server knows the account’s name (control)').not.toBe('');
      await expect(
        page.locator('.login__user-name').first(),
        'the password step shows who is signing in (FR-SL-025)',
      ).toHaveText(expectedName);
      await expect(page.locator('.login__user-id').first(), 'and the id they typed').toHaveText(
        testData.kpostId,
        { ignoreCase: true },
      );

      // 3) A wrong password is rejected: inline error, and we never leave /login.
      await loginPage.passwordInput.fill('DefinitelyNotMyPassword!9f2a');
      await expect(loginPage.loginButton).toBeEnabled();
      await loginPage.loginButton.click();
      await expect(loginPage.inlineError, 'a wrong password shows the inline error').toBeVisible({
        timeout: 15_000,
      });
      await expect(page, 'a wrong password must not log in').toHaveURL(/\/login/);
    },
  );

  // A correct login reaching /home is proven by the `setup` project, so it is not duplicated here.
});
