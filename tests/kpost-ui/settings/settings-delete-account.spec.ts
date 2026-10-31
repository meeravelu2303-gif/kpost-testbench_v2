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

    test('a deactivation code that cannot be sent tells the user to contact the admin team @ui', async ({
      page,
      settingsPage,
    }) => {
      // Confirm sends a real deactivation OTP to the account's phone, so EVERY deactivation call is
      // answered in the browser (the server's failure shape) and never leaves it. Registered before the
      // page loads; the count proves the request was caught.
      let answeredLocally = 0;
      await page.route(/deactivat/i, (route) => {
        answeredLocally += 1;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'FAILURE', statusCode: 400, message: '' }),
        });
      });
      await settingsPage.goto();
      await settingsPage.openPanel('My Account', 'Delete My Account');
      await page
        .getByText(/I don.t want to use anymore/i)
        .first()
        .click();
      await page
        .getByRole('button', { name: /^Confirm$/i })
        .first()
        .click();
      await expect(
        page
          .locator('.Toastify__toast')
          .filter({ hasText: 'Please contact the Admin Team..' })
          .first(),
        'the user is told to contact the admin team',
      ).toBeVisible({ timeout: 10_000 });
      expect(
        answeredLocally,
        'the deactivation request was answered in the browser',
      ).toBeGreaterThan(0);
    });
  },
);
