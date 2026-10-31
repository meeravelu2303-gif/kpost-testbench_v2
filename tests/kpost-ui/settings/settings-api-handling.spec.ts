import type { Page } from '@playwright/test';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Settings: when the server refuses or does not answer, the screen says so. One call is failed in
 * the browser per test (the shape each screen reacts to, read from its service), so nothing is
 * changed on the account. The account-deactivation calls are answered in the browser and never
 * leave it (no OTP is texted, nothing is deactivated).
 */
const toastText = (page: Page, text: string) =>
  page.locator('.Toastify__toast').filter({ hasText: text }).first();

const failure = (status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify({
    status: 'FAILURE',
    statusCode: status === 200 ? 400 : status,
    message: '',
  }),
});

/** A 1×1 PNG, for the photo upload. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

test.describe(
  'KPost Settings · a failed save or load is reported',
  {
    tag: ['@ui', '@settings', '@regression'],
    annotation: [{ type: 'non-functional', description: 'resilience' }],
  },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real QA account (QA_KPOST_ID)',
    );

    test('Data Storage reports a storage list it could not load', async ({
      page,
      settingsPage,
    }) => {
      await page.route('**/kmailData/getKloudUsedData**', (route) => route.fulfill(failure()));
      await settingsPage.goto();
      await settingsPage.openPanel('General Settings', 'Data Storage');
      await page.getByText('KPOST Cloud Storage').filter({ visible: true }).first().click();
      await expect(toastText(page, 'Error in Data Used List'), 'the user is told').toBeVisible({
        timeout: 10_000,
      });
    });

    test('a Digital Card visibility change the server refuses is reported', async ({
      page,
      settingsPage,
    }) => {
      await page.route('**/profile/updatePrivacySettingDetails**', (route) =>
        route.fulfill(failure(500)),
      );
      await settingsPage.goto();
      await settingsPage.openTopLevelPanel('Digital Card Settings');
      await page.locator('label.dc-toggle').filter({ visible: true }).first().click();
      await expect(
        toastText(page, 'Failed to update. Please try again.'),
        'the user is told the change was not saved',
      ).toBeVisible({ timeout: 10_000 });
    });

    test('an experience record that cannot be saved is reported', async ({
      page,
      settingsPage,
    }) => {
      await page.route('**/profile/saveOrUpdateExperienceDetails**', (route) => route.abort());
      await settingsPage.goto();
      await settingsPage.openPanel('Profile Creation', 'Experience');
      const addNew = page.getByText(/^\+?\s*Add New Experience$/i).first();
      // Add a row only when no empty one is open (every open row must be complete to save).
      const hasEmpty = await page.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLInputElement>('input[placeholder="Enter Company Name"]'),
        ].some((i) => i.offsetParent !== null && i.value === ''),
      );
      if (!hasEmpty && (await addNew.isVisible({ timeout: 5_000 }).catch(() => false)))
        await addNew.click();
      // The new (last) row: every field is required before Save.
      const last = (placeholder: string) =>
        page.getByPlaceholder(placeholder).filter({ visible: true }).last();
      await last('Enter Company Name').fill('QA Bench Ltd');
      await last('Enter Designation').fill('QA Tester');
      await last('Enter Company Location').fill('Chennai');
      await last('Enter Achievements').fill('QA bench record (not saved)');
      await last('From').fill('2020-01-01');
      await last('To').fill('2021-01-01');
      await page
        .getByRole('button', { name: /^Save$/ })
        .filter({ visible: true })
        .last()
        .click();
      await expect(
        toastText(page, 'Something went wrong. Please try again.'),
        'the user is told the record was not saved',
      ).toBeVisible({ timeout: 10_000 });
    });

    test('a profile photo removal the server refuses is reported', async ({
      page,
      settingsPage,
    }) => {
      await page.route('**/profile/removeProfileImage**', (route) => route.fulfill(failure()));
      await settingsPage.goto();
      await page
        .getByRole('button', { name: 'Delete profile picture' })
        .filter({ visible: true })
        .first()
        .click();
      await page
        .getByRole('button', { name: /^(Yes|Ok|Confirm|Delete|Remove)$/i })
        .filter({ visible: true })
        .last()
        .click({ timeout: 5_000 })
        .catch(() => undefined);
      await expect(toastText(page, 'Profile remove failed'), 'the user is told').toBeVisible({
        timeout: 10_000,
      });
    });

    test('a profile photo removal that gets no answer is reported', async ({
      page,
      settingsPage,
    }) => {
      await page.route('**/profile/removeProfileImage**', (route) => route.abort());
      await settingsPage.goto();
      await page
        .getByRole('button', { name: 'Delete profile picture' })
        .filter({ visible: true })
        .first()
        .click();
      await page
        .getByRole('button', { name: /^(Yes|Ok|Confirm|Delete|Remove)$/i })
        .filter({ visible: true })
        .last()
        .click({ timeout: 5_000 })
        .catch(() => undefined);
      await expect(toastText(page, 'Unexpected error occurred'), 'the user is told').toBeVisible({
        timeout: 10_000,
      });
    });

    test('a profile photo upload the server refuses is reported', async ({
      page,
      settingsPage,
    }) => {
      await page.route('**/profile/updateProfileImage**', (route) => route.fulfill(failure()));
      await settingsPage.goto();
      await page
        .locator('label.pc-avatar-cam-label input[type="file"]')
        .first()
        .setInputFiles({ name: 'qa-bench.png', mimeType: 'image/png', buffer: PNG });
      await page
        .getByRole('button', { name: /^Done$/ })
        .filter({ visible: true })
        .last()
        .click();
      await expect(toastText(page, 'Profile upload failed'), 'the user is told').toBeVisible({
        timeout: 10_000,
      });
    });

    test('a deactivation the server refuses is reported (every deactivation call answered in the browser)', async ({
      page,
      settingsPage,
    }) => {
      // Registered before the page loads; none of these reaches the server.
      let local = 0;
      const answer = (body: object) => (route: Parameters<Parameters<Page['route']>[1]>[0]) => {
        local += 1;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(body),
        });
      };
      await page.route(
        /sendAccountDeactivationOtp/i,
        answer({ status: 'SUCCESS', statusCode: 200 }),
      );
      await page.route(/\/common\/validateOTP/i, answer({ status: 'SUCCESS', statusCode: 200 }));
      await page.route(
        /deactivateAccount/i,
        answer({ status: 'FAILURE', statusCode: 400, message: '' }),
      );
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
      const boxes = page.getByPlaceholder('0').filter({ visible: true });
      await expect(boxes.first(), 'the OTP boxes open').toBeVisible({ timeout: 10_000 });
      for (let i = 0; i < 6; i += 1) await boxes.nth(i).fill(String(i + 1));
      await page
        .getByRole('button', { name: /^Submit$/i })
        .filter({ visible: true })
        .last()
        .click();
      await expect(toastText(page, 'Failed to Deactivate'), 'the user is told').toBeVisible({
        timeout: 10_000,
      });
      expect(local, 'the deactivation calls were answered in the browser').toBeGreaterThanOrEqual(
        2,
      );
    });
  },
);
