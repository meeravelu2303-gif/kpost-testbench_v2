import type { Locator, Page } from '@playwright/test';
import { STORAGE_STATE_BUSINESS } from '@config/constants';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { pickReactSelect } from '../support/react-select';
import { chooseDesignation, MOBILE_FIELD, openAddMemberForm } from '../support/usermanagement';

/**
 * BUSINESS_S User Management › Add Manually refuses a bad mobile number (UserManagement.js
 * handleMobileChange / ValidateSecondaryNum: 10 digits starting 6-9, a secondary number that is valid
 * and differs from the primary) and lets a complete member through. addingUserByAdmin is blocked at
 * the network, so no member is ever provisioned.
 */

const ADD_MEMBER = '**/admin/addingUserByAdmin/**';
const INVALID_MOBILE =
  'Invalid mobile number. It should start with a digit between 6 and 9 and be 10 digits long.';

/** Blocks addingUserByAdmin; returns the bodies the screen tried to send. */
async function blockAdd(page: Page): Promise<Array<Record<string, unknown>>> {
  const sent: Array<Record<string, unknown>> = [];
  await page.route(ADD_MEMBER, (route) => {
    sent.push(JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>);
    return route.abort();
  });
  return sent;
}

/** A 10-digit mobile starting with 9 that no member of the company uses (random, checked by the screen). */
const freshMobile = (): string => `9${String(Date.now()).slice(-9)}`;

/** Opens Add Manually with a designation chosen (Mobile No enables only after one). */
async function openForm(page: Page): Promise<Locator> {
  const modal = await openAddMemberForm(page);
  await chooseDesignation(page, modal, 'Accounts Officer');
  await expect(modal.getByPlaceholder(MOBILE_FIELD), 'Mobile No enables').toBeEnabled({
    timeout: 10_000,
  });
  return modal;
}

/** Fills the rest of a valid member after the primary mobile. */
async function completeMember(page: Page, modal: Locator): Promise<void> {
  await modal.getByPlaceholder('Enter First Name').fill('QA');
  await modal.getByPlaceholder('Enter Last Name').fill('Validation');
  await pickReactSelect(
    modal.locator('.react-select__control').filter({ hasText: /Select Gender/ }),
    'Male',
    { page },
  );
}

const addButton = (modal: Locator): Locator => modal.getByRole('button', { name: /^ADD$/ });
/** By its label: the placeholder wording differs between builds. */
const secondMobile = (modal: Locator): Locator =>
  modal.getByRole('textbox', { name: 'Second Mobile No' });

test.describe(
  'KPost company-admin · User Management Add Manually refuses a bad mobile number',
  { tag: ['@ui', '@user-management', '@regression'] },
  () => {
    test.use({ storageState: STORAGE_STATE_BUSINESS });
    test.skip(
      process.env.BUSINESS_UI_LIFECYCLE !== 'true',
      'needs the BUSINESS_S admin session; set BUSINESS_UI_LIFECYCLE=true',
    );
    test.skip(
      !testData.businessSKpostId || testData.businessSKpostId.includes('qa.business'),
      'needs the BUSINESS_S account (QA_BUSINESS_S_KPOST_ID)',
    );

    test('a mobile starting with 1-5 is refused and the form stays locked', async ({ page }) => {
      const sent = await blockAdd(page);
      const modal = await openForm(page);
      await modal.getByPlaceholder(MOBILE_FIELD).pressSequentially('5123456789', { delay: 20 });
      await expect(modal.getByText(INVALID_MOBILE), 'the user is told why').toBeVisible({
        timeout: 10_000,
      });
      await expect(
        modal.getByPlaceholder('Enter First Name'),
        'the rest of the form stays locked',
      ).toBeDisabled();
      await expect(addButton(modal), 'ADD stays disabled').toBeDisabled();
      expect(sent, 'nothing was sent').toHaveLength(0);
    });

    test('more than 10 digits (not a country code) is refused', async ({ page }) => {
      const modal = await openForm(page);
      await modal.getByPlaceholder(MOBILE_FIELD).pressSequentially('98765432101', { delay: 20 });
      await expect(
        modal.getByText('Enter a 10-digit mobile number, with or without the country code.'),
        'the user is told the number is too long',
      ).toBeVisible({ timeout: 10_000 });
      await expect(addButton(modal), 'ADD stays disabled').toBeDisabled();
    });

    test('a secondary mobile equal to the primary is refused', async ({ page }) => {
      const sent = await blockAdd(page);
      const modal = await openForm(page);
      const mobile = freshMobile();
      await modal.getByPlaceholder(MOBILE_FIELD).pressSequentially(mobile, { delay: 20 });
      await completeMember(page, modal);
      await secondMobile(modal).pressSequentially(mobile, { delay: 20 });
      await expect(
        modal.getByText('Mobile Number and Secondary Mobile Number Cannot be Same!'),
        'the user is told the two numbers are the same',
      ).toBeVisible({ timeout: 10_000 });
      await expect(addButton(modal), 'ADD stays disabled while they match').toBeDisabled();
      expect(sent, 'nothing was sent').toHaveLength(0);
    });

    test('an invalid secondary mobile is refused and blocks ADD', async ({ page }) => {
      const sent = await blockAdd(page);
      const modal = await openForm(page);
      await modal.getByPlaceholder(MOBILE_FIELD).pressSequentially(freshMobile(), { delay: 20 });
      await completeMember(page, modal);
      await secondMobile(modal).pressSequentially('5123456789', { delay: 20 });
      await expect(modal.getByText(INVALID_MOBILE), 'the user is told why').toBeVisible({
        timeout: 10_000,
      });
      await expect(
        addButton(modal),
        'ADD stays disabled while the secondary number is invalid',
      ).toBeDisabled();
      expect(sent, 'nothing was sent').toHaveLength(0);
    });

    test('a complete member with a valid mobile can be added', async ({ page }) => {
      const sent = await blockAdd(page);
      const modal = await openForm(page);
      const mobile = freshMobile();
      await modal.getByPlaceholder(MOBILE_FIELD).pressSequentially(mobile, { delay: 20 });
      await completeMember(page, modal);
      await expect(addButton(modal), 'ADD enables for a complete member').toBeEnabled({
        timeout: 15_000,
      });
      await addButton(modal).click();
      await expect
        .poll(() => sent.length, { message: 'the member is sent', timeout: 10_000 })
        .toBe(1);
      expect(sent[0]?.mobileNumber, 'with the mobile as typed').toBe(mobile);
      expect(sent[0]?.gender, 'and the gender chosen').toBe('male');
    });
  },
);
