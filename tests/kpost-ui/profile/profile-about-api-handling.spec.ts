import type { Locator, Page } from '@playwright/test';
import { testData } from '@config/test-data.config';
import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';
import { openProfileSection } from '../support/profile';

/**
 * Profile API handling, stubbed in the browser:
 * - /userprofile (UserProfile.js getUserDetails → GET /profile/getUserProfile/): a failed load must
 *   say so rather than render empty sections, and a reload recovers;
 * - Settings › Profile Creation › About (Settings/About/About.js handleSave → POST
 *   /profile/updateAboutYourself/): a refused save shows a readable error and does not keep the
 *   unsaved text as if it were saved.
 * updateAboutYourself is always answered in the browser, so the profile is never changed.
 */
const PROFILE = '**/profile/getUserProfile/**';
const ABOUT_SAVE = '**/profile/updateAboutYourself/**';
const BOUNDARY = /Something went wrong/i;
const ERROR_TEXT = /error|fail|unable|could not|try again|went wrong|not saved/i;

async function userIsTold(page: Page): Promise<boolean> {
  return page
    .locator('.Toastify__toast, [role="alert"], .alert-danger, [class*="error" i]', {
      hasText: ERROR_TEXT,
    })
    .first()
    .waitFor({ state: 'visible', timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
}

async function gotoUserProfile(page: Page): Promise<void> {
  await page.goto('/userprofile', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page
    .locator('.loader-overlay')
    .waitFor({ state: 'hidden', timeout: 30_000 })
    .catch(() => undefined);
}

/** Settings › Profile Creation › About; returns the editor and its Update button. */
async function openAbout(page: Page): Promise<{ editor: Locator; update: Locator }> {
  const panel = await openProfileSection(page, 'About');
  const editor = panel.getByPlaceholder('Write about yourself...').first();
  await expect(editor, 'the About editor renders').toBeVisible({ timeout: 20_000 });
  return { editor, update: panel.getByRole('button', { name: /^Update$/ }).first() };
}

test.describe(
  'KPost Profile · profile load and About save failures are reported',
  {
    tag: ['@ui', '@profile', '@regression'],
    annotation: [{ type: 'non-functional', description: 'resilience' }],
  },
  () => {
    test.describe.configure({ timeout: 180_000 });
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real QA account (QA_KPOST_ID)',
    );

    test('a profile load that answers HTTP 500 is reported and the page stays up @ui', async ({
      page,
    }) => {
      let called = false;
      await page.route(PROFILE, (route) => {
        called = true;
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'FAILURE', statusCode: 500, error: 'Internal' }),
        });
      });
      const stop = watchUiHealth(page);
      await gotoUserProfile(page);
      await expect.poll(() => called, { message: 'the profile load fired' }).toBe(true);
      await expect(page.locator('#About'), 'the profile page renders').toBeVisible({
        timeout: 20_000,
      });
      await expect(page.getByText(BOUNDARY), 'no error boundary').toHaveCount(0);
      expect(stop().pageErrors, 'no uncaught error on a failed profile load').toEqual([]);
      const told = await userIsTold(page);
      test.info().annotations.push({
        type: 'observed',
        description: told
          ? 'error shown on failed profile load'
          : 'profile load failed with NO visible error (sections render empty)',
      });
      expect(told, 'a profile that failed to load must tell the user').toBe(true);
    });

    test('a profile load with no answer is reported, and a reload fills the About section @ui', async ({
      page,
    }) => {
      let called = false;
      await page.route(PROFILE, (route) => {
        called = true;
        return route.abort('failed');
      });
      await gotoUserProfile(page);
      await expect.poll(() => called, { message: 'the profile load fired' }).toBe(true);
      const told = await userIsTold(page);
      test.info().annotations.push({
        type: 'observed',
        description: told ? 'error shown on network failure' : 'network failure: NO feedback',
      });
      expect.soft(told, 'a profile that never loaded must tell the user').toBe(true);

      await page.unroute(PROFILE);
      const loaded = page.waitForResponse(
        (r) => r.url().includes('/profile/getUserProfile/') && r.status() === 200,
        { timeout: 45_000 },
      );
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 });
      await loaded;
      await expect(
        page.locator('#About .nuntio-font').first(),
        'the About section is filled once the profile loads',
      ).not.toBeEmpty({ timeout: 20_000 });
    });

    test('an About save that answers HTTP 500 shows a readable error @ui', async ({ page }) => {
      let calls = 0;
      await page.route(ABOUT_SAVE, (route) => {
        calls += 1;
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'FAILURE', statusCode: 500, message: '' }),
        });
      });
      const { editor, update } = await openAbout(page);
      await editor.fill(`QA api-handling about ${Date.now()}`);
      await update.click();
      await expect.poll(() => calls, { message: 'the save request fired' }).toBeGreaterThan(0);
      const toastTexts = await page
        .locator('.Toastify__toast')
        .allInnerTexts()
        .catch(() => [] as string[]);
      const told = await userIsTold(page);
      test.info().annotations.push({
        type: 'observed',
        description: `error shown: ${told}; toasts: ${JSON.stringify(toastTexts).slice(0, 200)}`,
      });
      expect(told, 'a failed About save must show a readable error (not a blank toast)').toBe(true);
    });

    test('an About save the server refuses (FAILURE envelope) shows its reason @ui', async ({
      page,
    }) => {
      let calls = 0;
      await page.route(ABOUT_SAVE, (route) => {
        calls += 1;
        return route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 'FAILURE',
            statusCode: 400,
            message: 'About could not be saved',
          }),
        });
      });
      const { editor, update } = await openAbout(page);
      await editor.fill(`QA api-handling about ${Date.now()}`);
      await update.click();
      await expect.poll(() => calls, { message: 'the save request fired' }).toBeGreaterThan(0);
      const told = await userIsTold(page);
      test.info().annotations.push({
        type: 'observed',
        description: told ? 'refusal reported' : 'refused save: NO readable error',
      });
      expect(told, 'a refused About save must tell the user why').toBe(true);
    });

    test('after a failed About save, a reload shows the saved text, not the unsaved one @ui', async ({
      page,
    }) => {
      await page.route(ABOUT_SAVE, (route) =>
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'FAILURE', statusCode: 500, message: '' }),
        }),
      );
      const first = await openAbout(page);
      const original = await first.editor.inputValue();
      const unsaved = `QA unsaved about ${Date.now()}`;
      const sent = page.waitForResponse((r) => r.url().includes('/profile/updateAboutYourself'), {
        timeout: 20_000,
      });
      await first.editor.fill(unsaved);
      await first.update.click();
      await sent;

      await page.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 });
      const again = await openAbout(page);
      test.info().annotations.push({
        type: 'observed',
        description: `original About before the refused save: "${original.slice(0, 80)}"`,
      });
      await expect(
        again.editor,
        'text the server refused must not come back as if it were saved',
      ).not.toHaveValue(unsaved);
    });
  },
);
