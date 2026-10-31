import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { countRequests } from '../support/validation';

/**
 * Settings › General Settings › Personalize › Change Theme refuses an "Image" chat background with no
 * image chosen (Personalize.js handleApplyTheme). The theme save is blocked at the network and
 * counted, so the account's theme is never changed.
 */
test.describe(
  'KPost Settings · Personalize refuses a wallpaper background without an image',
  { tag: ['@ui', '@settings', '@regression'] },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real QA account (QA_KPOST_ID)',
    );

    test('Apply Theme with "Image" chosen and no image uploaded is refused', async ({
      page,
      settingsPage,
    }) => {
      await page.route('**/generalSetting/changeTheme**', (route) => route.abort());
      const saves = countRequests(page, '/generalSetting/changeTheme');
      await settingsPage.goto();
      await page.getByText('General Settings', { exact: true }).first().click();
      await page
        .getByText(/^Personalize$/)
        .first()
        .click();
      await page
        .getByText(/^Change Theme$/)
        .first()
        .click();

      // The "Katchup Chat Background Theme & Wallpaper" select → "Image".
      const field = page
        .locator('div')
        .filter({
          has: page.getByText('Katchup Chat Background Theme & Wallpaper', { exact: true }),
        })
        .filter({ has: page.getByRole('combobox') })
        .last();
      await field.getByRole('combobox').first().click();
      await page
        .getByRole('option', { name: /^Image$/ })
        .first()
        .click();
      await page.getByRole('button', { name: /Apply Theme/i }).click();
      await expect(
        page
          .locator('.Toastify__toast')
          .filter({ hasText: 'Please upload a wallpaper image first' })
          .first(),
        'the user is told to upload an image first',
      ).toBeVisible({ timeout: 10_000 });
      expect(saves(), 'no theme was saved').toBe(0);
    });
  },
);
