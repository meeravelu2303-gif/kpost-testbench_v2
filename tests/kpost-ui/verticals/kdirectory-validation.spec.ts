import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { parkPointerAwayFromSideMenu } from '../support/katchup';
import { pickReactSelect, reactSelectByPlaceholder } from '../support/react-select';

/**
 * KDirectory › Advanced Search refuses a pincode that no post office has
 * (KdirectoryAdvanceSearch.js PincodeModal: six digits are looked up straight away). Read-only.
 */
test.describe(
  'KPost KDirectory · Advanced Search refuses a pincode that does not exist',
  { tag: ['@ui', '@kdirectory', '@regression'] },
  () => {
    test.skip(!testData.kpostId, 'needs a real QA account (QA_KPOST_ID)');

    test('a well-formed pincode with no post office is refused', async ({ page }) => {
      await page.goto('/kdirectory', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page
        .locator('.loader-overlay')
        .waitFor({ state: 'hidden', timeout: 30_000 })
        .catch(() => undefined);
      await parkPointerAwayFromSideMenu(page);
      await pickReactSelect(reactSelectByPlaceholder(page, /Select Country/i), 'India', { page });
      await pickReactSelect(reactSelectByPlaceholder(page, /Choose Language/i), 'English', {
        page,
      });
      await page
        .locator('.dirCategory-box, .selectedCategory-box')
        .filter({ hasText: /^Personal$/ })
        .first()
        .click();
      await page.getByRole('button', { name: /^Continue$/i }).click();
      await page.locator('div.icon-KP_225_Advanced-Search').first().click({ timeout: 15_000 });
      await page.getByPlaceholder('Enter Pincode').first().fill('000000');
      await expect(
        page.locator('.Toastify__toast').filter({ hasText: 'Invalid postal pincode' }).first(),
        'the user is told the pincode does not exist',
      ).toBeVisible({ timeout: 10_000 });
    });
  },
);
