import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Login submit state (reported manually 2026-10-13): after Login is pressed the button enters a
 * loading state, but the password field still accepts typing. Correct behaviour: while a login is
 * in flight the form is locked — the password cannot be edited mid-submit (preventing a second,
 * racing submit and the confusing case where the field value no longer matches what was sent).
 *
 * The `userLogin` response is DELAYED (not provoked with a real wrong password — repeated wrong
 * passwords would lock this shared account out of every other suite) so the in-flight/loading window
 * stays open long enough to observe. The assertion is behavioural (typing during the window must not
 * change the field) so it holds whether the fix disables the input or makes it read-only.
 */
test.describe(
  'KPost UI · login submit locks the form while in flight',
  { tag: ['@ui', '@auth', '@regression'] },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real, known KPOST ID to reach the password step',
    );

    // Re-verifying #1335 [KP-LOGINSUBMITUNLOCKED] post-deploy 2026-10-13: run live (un-fixme).
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
      await loginPage.passwordInput.pressSequentially('XYZ', { timeout: 4_000 }).catch(() => undefined);

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
