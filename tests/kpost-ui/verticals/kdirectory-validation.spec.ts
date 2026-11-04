import type { Page } from '@playwright/test';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { parkPointerAwayFromSideMenu } from '../support/katchup';
import { pickReactSelect, reactSelectByPlaceholder } from '../support/react-select';

/**
 * KDirectory › Advanced Search: the mobile and pincode fields stop at 10 and 6 digits, and a pincode
 * that no post office has is refused
 * (KdirectoryAdvanceSearch.js PincodeModal: six digits are looked up straight away). Read-only.
 */
test.describe(
  'KPost KDirectory · Advanced Search refuses a pincode that does not exist',
  { tag: ['@ui', '@verticals', '@regression'] },
  () => {
    test.skip(!testData.kpostId, 'needs a real QA account (QA_KPOST_ID)');

    // KdirectoryAdvanceSearch.js: maxLength 10 (mobile) and 6 (pincode), typed like a user.
    test('Mobile Number stops at 10 digits and Pincode at 6', async ({ page }) => {
      await openAdvancedSearch(page);
      const mobile = page.getByPlaceholder('Enter Mobile Number').first();
      await mobile.pressSequentially('98765432101', { delay: 0 });
      await expect(mobile, 'an 11th mobile digit is not taken').toHaveValue('9876543210');
      const pin = page.getByPlaceholder('Enter Pincode').first();
      await pin.pressSequentially('6000011', { delay: 0 });
      await expect(pin, 'a 7th pincode digit is not taken').toHaveValue('600001');
    });

    test('a well-formed pincode with no post office is refused', async ({ page }) => {
      await openAdvancedSearch(page);
      await page.getByPlaceholder('Enter Pincode').first().fill('000000');
      await expect(
        page.locator('.Toastify__toast').filter({ hasText: 'Invalid postal pincode' }).first(),
        'the user is told the pincode does not exist',
      ).toBeVisible({ timeout: 10_000 });
    });
  },
);

/** KDirectory › Personal (India, English) › Advanced Search. */
async function openAdvancedSearch(page: Page): Promise<void> {
  await page.goto('/kdirectory', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page
    .locator('.loader-overlay')
    .waitFor({ state: 'hidden', timeout: 30_000 })
    .catch(() => undefined);
  await parkPointerAwayFromSideMenu(page);
  await pickReactSelect(reactSelectByPlaceholder(page, /Select Country/i), 'India', { page });
  await pickReactSelect(reactSelectByPlaceholder(page, /Choose Language/i), 'English', { page });
  await page
    .locator('.dirCategory-box, .selectedCategory-box')
    .filter({ hasText: /^Personal$/ })
    .first()
    .click();
  await page.getByRole('button', { name: /^Continue$/i }).click();
  await page.locator('div.icon-KP_225_Advanced-Search').first().click({ timeout: 15_000 });
}
