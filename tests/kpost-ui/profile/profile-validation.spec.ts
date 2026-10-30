import type { Page } from '@playwright/test';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { openProfileSection } from '../support/profile';
import { sendsWithin, toast } from '../support/validation';

/**
 * Settings › Profile Creation refuses invalid values before saving (BasicInformation.js,
 * ContactInformation.js, Experience.js): a date of birth that is not a real adult's, a malformed
 * e-mail, an empty required address field, an incomplete or impossible experience entry. Every save
 * is blocked at the network, so a value the screen wrongly lets through is counted, never stored.
 */

/** Blocks requests whose URL contains `path`; returns how many the screen tried to send. */
async function block(page: Page, path: string): Promise<() => number> {
  let attempts = 0;
  await page.route(`**${path}**`, (route) => {
    attempts += 1;
    return route.abort();
  });
  return () => attempts;
}

test.describe(
  'KPost Profile · Profile Creation refuses invalid values before saving',
  { tag: ['@ui', '@profile', '@regression'] },
  () => {
    test.describe.configure({ mode: 'default', timeout: 120_000 });
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real QA account (QA_KPOST_ID)',
    );

    test('Basic Information: an under-18 date of birth is flagged and not saved', async ({
      page,
    }) => {
      const sent = await block(page, '/profile/updateBasicInformation');
      const panel = await openProfileSection(page, 'Basic Information');
      const dob = panel.getByPlaceholder('yyyy-mm-dd').first();
      await expect(dob, 'the date of birth field renders').toBeVisible({ timeout: 20_000 });
      await dob.fill(`${new Date().getFullYear() - 5}-01-01`);
      await expect
        .soft(
          panel
            .locator('.text-danger')
            .filter({ hasText: /Year must be between|at least 18/ })
            .first(),
          'the user is told why',
        )
        .toBeVisible({ timeout: 10_000 });
      const tried = sendsWithin(page, '/profile/updateBasicInformation');
      await panel
        .getByRole('button', { name: /^Update$/ })
        .first()
        .click();
      expect(await tried, 'an invalid date of birth never reaches the server').toBe(false);
      expect(sent(), 'and no save was attempted').toBe(0);
    });

    test('Basic Information: a malformed Other Email ID is refused and not saved', async ({
      page,
    }) => {
      const sent = await block(page, '/profile/updateBasicInformation');
      const panel = await openProfileSection(page, 'Basic Information');
      const email = panel.getByPlaceholder('Enter Email ID').first();
      await expect(email, 'the e-mail field renders').toBeVisible({ timeout: 20_000 });
      await email.fill('not-an-email');
      await panel
        .getByRole('button', { name: /^Update$/ })
        .first()
        .click();
      await expect(
        toast(page, 'Please enter a valid email address'),
        'the user is told why',
      ).toBeVisible({
        timeout: 10_000,
      });
      expect(sent(), 'a malformed e-mail never reaches the server').toBe(0);
    });

    test('Contact Information: an empty required field is refused and not saved', async ({
      page,
    }) => {
      const sent = await block(page, '/profile/updateContactInformation');
      const panel = await openProfileSection(page, 'Contact Information');
      const city = panel.getByPlaceholder('Enter City').first();
      await expect(city, 'the Contact Information form renders').toBeVisible({ timeout: 20_000 });
      test.skip(
        !(await city.inputValue().catch(() => '')),
        'no saved address on this account yet, so there is no required value to clear',
      );
      await city.fill('');
      await panel
        .getByRole('button', { name: /^Update$/ })
        .first()
        .click();
      await expect(
        toast(page, 'Please Fill all the Required Fields'),
        'the user is told why',
      ).toBeVisible({ timeout: 10_000 });
      expect(sent(), 'an address with no city never reaches the server').toBe(0);
    });

    test('Experience: an entry with empty fields is refused and not saved', async ({ page }) => {
      const sent = await block(page, '/profile/saveOrUpdateExperienceDetails');
      const panel = await openProfileSection(page, 'Experience');
      await panel
        .getByRole('button', { name: /Add New Experience/i })
        .first()
        .click();
      const card = panel.locator('.pc-entry-card').last();
      await card
        .locator('.pc-entry-footer')
        .getByRole('button', { name: /^Save$/ })
        .click();
      await expect(
        toast(page, 'Please fill all fields before Save.'),
        'the user is told why',
      ).toBeVisible({
        timeout: 10_000,
      });
      expect(sent(), 'an incomplete experience never reaches the server').toBe(0);
    });

    test('Experience: a period that ends before it starts is refused', async ({ page }) => {
      const sent = await block(page, '/profile/saveOrUpdateExperienceDetails');
      const panel = await openProfileSection(page, 'Experience');
      await panel
        .getByRole('button', { name: /Add New Experience/i })
        .first()
        .click();
      const card = panel.locator('.pc-entry-card').last();
      await card.getByPlaceholder('Enter Company Name').fill('QA Bench Validation Co');
      await card.getByPlaceholder('Enter Designation').fill('QA Engineer');
      await card.getByPlaceholder('Enter Company Location').fill('Chennai');
      await card.getByPlaceholder('Enter Achievements').fill('QA validation entry');
      await card.getByPlaceholder('From').fill('2022');
      await card.getByPlaceholder('To').fill('2020');
      const tried = sendsWithin(page, '/profile/saveOrUpdateExperienceDetails');
      await card
        .locator('.pc-entry-footer')
        .getByRole('button', { name: /^Save$/ })
        .click();
      expect(await tried, 'an experience from 2022 to 2020 never reaches the server').toBe(false);
      expect(sent(), 'and no save was attempted').toBe(0);
    });
  },
);
