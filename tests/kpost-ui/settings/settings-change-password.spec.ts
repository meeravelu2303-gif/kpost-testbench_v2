import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Settings › Change Password: client-side validation only (old-password check, new-password rules,
 * confirm match). No spare account exists, so the real change-password call is blocked and Submit is never clicked.
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
      // Deliberately wrong: rejected against Redux state, never reaching the API.
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
      // The Old Password step compares in the browser (no request). The change-password call is also
      // blocked at the network, so a stray Submit cannot change the shared account's password.
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

    test('Submit with a Confirm that differs is refused with "Passwords Does Not Match!" @ui', async ({
      page,
      settingsPage,
    }) => {
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
      await newPassword.fill('QaBench!9x');
      await page
        .getByPlaceholder(/Enter Your Confirm Password/i)
        .first()
        .fill('QaBench!9y');
      const submit = page.getByRole('button', { name: /^Submit$/i }).last();
      // Refused either way the screen chooses: Submit stays off, or Submit names the rule.
      if (await submit.isEnabled()) {
        await submit.click();
        await expect(
          page.locator('.Toastify__toast').filter({ hasText: 'Passwords Does Not Match!' }).first(),
          'the user is told the passwords differ',
        ).toBeVisible({ timeout: 10_000 });
      } else {
        await expect(submit, 'Submit stays disabled while they differ').toBeDisabled();
      }
      expect(changeAttempts, 'nothing tried to change the password').toBe(0);
    });
  },
);
