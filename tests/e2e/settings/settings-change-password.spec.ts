import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Settings · Change Password panel (`Changepassword.js`) — this DOES call a real backend endpoint
 * (`changePasswordApi` -> `POST /v2/profile/changePassword`) and, on success, force-logs-out the
 * account. Unlike the forgot-password flow (which has its own dedicated spare account,
 * `QA_FORGOT_PASSWORD_KPOST_ID`), no spare account exists for THIS in-app flow, which additionally
 * requires the CURRENT password matched against Redux state before it even reaches the API — there is
 * no safe way to complete it against any account this bench manages. So this file deliberately never
 * clicks the final "Submit" that fires the real API call; it only exercises the extensive CLIENT-SIDE
 * validation, which is itself real, substantial surface:
 *
 *  - Old Password step gates on a Redux-stored password comparison (client-side, no API) before
 *    progressing — confirmed from source: a mismatch never reaches the network.
 *  - New Password requires the regex `/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&~...])[...]{6,}$/`
 *    (lower+upper+digit+special, min 6, no spaces — space is blocked at keystroke level too).
 *  - Confirm Password must match New Password, checked live while typing in both directions.
 *
 * A DEEPER finding to verify, not exercised by writing this validation-only test but recorded here so
 * it isn't lost: `changePasswordApi`'s request body sends ONLY `{ oldPassword, confirmPassword }` —
 * the validated `newPassword` value is never included in the payload sent to the server. If accurate,
 * completing this flow could set the password to something other than what the user typed as "new",
 * or the server could reject/ignore the call outright. This needs a dedicated spare account before it
 * can be verified live — flagged, not filed, until that exists.
 */
test.describe(
  'KPost Settings · Change Password panel (validation only, no real submit)',
  { tag: ['@ui', '@settings', '@regression'] },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    test('entering the wrong Old Password is rejected client-side, before any API call @ui', async ({
      page,
      settingsPage,
    }) => {
      await settingsPage.goto();
      await settingsPage.openPanel('General Settings', 'Change Password');

      let requestFired = false;
      page.on('request', (req) => {
        if (req.url().includes('/profile/changePassword')) requestFired = true;
      });

      const oldPasswordField = page.getByPlaceholder(/Enter Your Old Password/i).first();
      await expect(oldPasswordField, 'the Old Password step renders').toBeVisible({
        timeout: 15_000,
      });
      // Deliberately wrong — this must be rejected against Redux state, never reach the API.
      await oldPasswordField.fill('definitely-the-wrong-password-99');
      await page
        .getByRole('button', { name: /^Continue$/i })
        .first()
        .click();

      await expect(
        page.getByText(/Old Password is Incorrect/i).first(),
        'a wrong Old Password is rejected with a clear error',
      ).toBeVisible({ timeout: 10_000 });

      expect(
        requestFired,
        'an incorrect Old Password must be rejected client-side (against Redux state) and never reach ' +
          'the changePassword API',
      ).toBe(false);
    });

    test('the New Password field enforces its complexity rule and Confirm must match, without ever submitting @ui', async ({
      page,
      settingsPage,
    }) => {
      // The bench knows qatest1's current password (QA_PASSWORD). The Old Password step compares it in
      // the browser (Changepassword.js `oldPasswordevent`, against the Redux-held password) — no request.
      // Belt and braces: the change-password call is BLOCKED at the network, so even a stray Submit
      // cannot change the shared account's password. Submit is never clicked.
      let changeAttempts = 0;
      await page.route('**/profile/changePassword**', (route) => {
        changeAttempts += 1;
        return route.abort();
      });

      await settingsPage.goto();
      await settingsPage.openPanel('General Settings', 'Change Password');
      await page
        .getByPlaceholder(/Enter Your Old Password/i)
        .first()
        .fill(testData.password);
      await page
        .getByRole('button', { name: /^Continue$/i })
        .first()
        .click();

      const newPassword = page.getByPlaceholder(/Enter Your New Password/i).first();
      await expect(newPassword, 'the correct Old Password opens step 2').toBeVisible({
        timeout: 10_000,
      });
      const confirm = page.getByPlaceholder(/Enter Your Confirm Password/i).first();
      const submit = page.getByRole('button', { name: /^Submit$/i }).last();

      await newPassword.fill('Ab1!x');
      await expect(
        page.getByText('Password must be at least 6 characters long.').first(),
        'under 6 characters',
      ).toBeVisible();

      await newPassword.fill('abcdefg1');
      await expect(
        page.getByText(/must contain at least one uppercase letter/i).first(),
        'no uppercase and no special character → the complexity rule is shown',
      ).toBeVisible();
      await expect(
        confirm,
        'Confirm stays locked while the new password is invalid',
      ).toBeDisabled();

      await newPassword.fill('QaBench!9x');
      await expect(page.getByText(/must contain at least one uppercase letter/i)).toHaveCount(0);
      await expect(confirm, 'a valid new password unlocks Confirm').toBeEnabled();

      await confirm.fill('QaBench!9y');
      await expect(
        page.getByText('Password and Confirm Password do not match').first(),
        'a different Confirm is flagged',
      ).toBeVisible();

      await confirm.fill('QaBench!9x');
      await expect(page.getByText('Password and Confirm Password do not match')).toHaveCount(0);
      await expect(
        submit,
        'matching passwords enable Submit (deliberately not clicked)',
      ).toBeEnabled();

      expect(changeAttempts, 'nothing tried to change the password').toBe(0);
    });
  },
);
