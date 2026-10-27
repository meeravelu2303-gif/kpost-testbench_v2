import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Settings › Delete Account: the reason-selection UI only. Confirm is never clicked, because it sends a
 * real account-deactivation OTP.
 */
test.describe(
  'KPost Settings · Delete Account panel (reason selection only — never confirms)',
  { tag: ['@ui', '@settings', '@regression'] },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    test('the reason-selection screen renders its options, and choosing "Others" reveals a free-text reason @ui', async ({
      page,
      settingsPage,
    }) => {
      await settingsPage.goto();
      await settingsPage.openPanel('My Account', 'Delete My Account');

      let deactivationRequestFired = false;
      page.on('request', (req) => {
        if (req.url().includes('/profile/sendAccountDeactivationOtp'))
          deactivationRequestFired = true;
        if (req.url().includes('/profile/deactivateAccount')) deactivationRequestFired = true;
      });

      await expect(
        page.getByText(/I don.t want to use anymore/i).first(),
        'the first delete-reason option renders',
      ).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(/I.m using another account/i).first()).toBeVisible();
      await expect(page.getByText(/Application is not friendly/i).first()).toBeVisible();

      const othersOption = page.getByText(/^Others$/i).first();
      await expect(othersOption, 'the "Others" option renders').toBeVisible();
      await othersOption.click();

      const reasonField = page.getByPlaceholder(/Write your Reason/i).first();
      await expect(reasonField, 'choosing "Others" reveals a free-text reason field').toBeVisible({
        timeout: 10_000,
      });
      await reasonField.fill('QA UI test — reason-selection render check only, never confirmed');

      // Confirm exists but is NEVER clicked: it sends a real deactivation OTP.
      await expect(
        page.getByRole('button', { name: /^Confirm$/i }).first(),
        'the Confirm control is present — NOT clicked, since it fires a real OTP send',
      ).toBeVisible();

      expect(
        deactivationRequestFired,
        'reason selection alone (never clicking Confirm) must never reach the account-deactivation API',
      ).toBe(false);
    });
  },
);
