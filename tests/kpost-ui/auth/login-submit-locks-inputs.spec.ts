import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * While a login is in flight the password field must not accept typing. The userLogin response is
 * held open to keep the window observable; the check is behavioural (disabled or read-only both pass).
 */
test.describe(
  'KPost UI · login submit locks the form while in flight',
  { tag: ['@ui', '@auth', '@regression'] },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real, known KPOST ID to reach the password step',
    );

    test('the password field cannot be edited while a login is submitting @ui', async ({
      loginPage,
      page,
    }) => {
      // Hold the login response open so the loading/in-flight state persists while we probe the field.
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => (release = resolve));
      await page.route('**/userLogin**', async (route) => {
        await held;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            statusCode: 401,
            status: 'FAILURE',
            message: 'Invalid Credential',
            accessToken: null,
            data: null,
          }),
        });
      });

      await loginPage.goto();
      await loginPage.expectLoaded();
      await loginPage.enterLoginId(testData.kpostId);
      await expect(loginPage.passwordInput, 'the password step is shown').toBeVisible({
        timeout: 20_000,
      });

      const typed = 'QaPassw0rd!';
      await loginPage.passwordInput.fill(typed);
      await expect(loginPage.loginButton).toBeEnabled();

      // Start the submit but do NOT await it (the response is held open above).
      await loginPage.loginButton.click();

      // The login is now in flight. Try to append to the password; a locked form must ignore it.
      await loginPage.passwordInput
        .pressSequentially('XYZ', { timeout: 4_000 })
        .catch(() => undefined);

      const valueDuringSubmit = await loginPage.passwordInput.inputValue().catch(() => '');
      // Release the held response regardless of the assertion outcome so the route never dangles.
      release();

      expect(
        valueDuringSubmit,
        'while a login is submitting the password field must be locked (typing must not change its value)',
      ).toBe(typed);
    });
  },
);
