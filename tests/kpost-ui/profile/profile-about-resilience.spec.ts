import type { Locator, Page } from '@playwright/test';
import { testData } from '@config/test-data.config';
import { healthFailures, isResponsive, watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';
import { openProfileSection } from '../support/profile';

/**
 * Profile under a bad network: a double click on About › Update sends one save, a slow profile load
 * still fills /userprofile, going offline at Update keeps the typed text, and a reload mid-save does
 * not resend. Selectors from Settings/About/About.js and UserProfile/UserProfile.js. The About save
 * (POST /profile/updateAboutYourself/) is always answered in the browser, so nothing is saved.
 */
const PROFILE = '**/profile/getUserProfile/**';
const ABOUT_SAVE = '**/profile/updateAboutYourself/**';
const BOUNDARY = /Something went wrong/i;
const REFUSAL = {
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ status: 'FAILURE', statusCode: 400, message: 'QA bench refusal' }),
};
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function openAbout(page: Page): Promise<{ editor: Locator; update: Locator }> {
  const panel = await openProfileSection(page, 'About');
  const editor = panel.getByPlaceholder('Write about yourself...').first();
  await expect(editor, 'the About editor renders').toBeVisible({ timeout: 20_000 });
  return { editor, update: panel.getByRole('button', { name: /^Update$/ }).first() };
}

test.describe(
  'KPost Profile · About and profile page under a slow or lost network',
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

    test('a double click on About › Update sends one save @ui', async ({ page }) => {
      let calls = 0;
      await page.route(ABOUT_SAVE, async (route) => {
        calls += 1;
        await delay(3_000);
        await route.fulfill(REFUSAL).catch(() => undefined);
      });
      const { editor, update } = await openAbout(page);
      await editor.fill(`QA resilience about ${Date.now()}`);
      const answered = page.waitForResponse(
        (r) => r.url().includes('/profile/updateAboutYourself'),
        { timeout: 20_000 },
      );
      await update.dblclick();
      await answered;
      test.info().annotations.push({ type: 'observed', description: `save requests: ${calls}` });
      expect(calls, 'one double click must send one save, not two').toBe(1);
    });

    test('a slow profile load still fills the About section when it arrives @ui', async ({
      page,
    }) => {
      await page.route(PROFILE, async (route) => {
        await delay(6_000);
        await route.continue().catch(() => undefined);
      });
      await page.goto('/userprofile', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await expect(page.locator('#About'), 'the profile page renders').toBeVisible({
        timeout: 30_000,
      });
      await expect(
        page.locator('#About .nuntio-font').first(),
        'the About section fills once the slow load answers',
      ).not.toBeEmpty({ timeout: 45_000 });
      await expect(page.getByText(BOUNDARY), 'no error boundary').toHaveCount(0);
    });

    test('going offline at Update keeps the typed text, and Update works once back online @ui', async ({
      page,
      context,
    }) => {
      let calls = 0;
      await page.route(ABOUT_SAVE, (route) => {
        calls += 1;
        return route.fulfill(REFUSAL);
      });
      const text = `QA resilience about ${Date.now()}`;
      const { editor, update } = await openAbout(page);
      await editor.fill(text);
      const stop = watchUiHealth(page);
      await context.setOffline(true);
      try {
        await update.click();
        await expect(page.getByText(BOUNDARY), 'no error boundary while offline').toHaveCount(0);
        expect(await isResponsive(page), 'the screen does not freeze offline').toBe(true);
        await expect(editor, 'the typed text survives the dropped network').toHaveValue(text);
      } finally {
        await context.setOffline(false);
      }
      const before = calls;
      await update.click();
      await expect
        .poll(() => calls, { message: 'a retry once online sends the save' })
        .toBeGreaterThan(before);
      expect(healthFailures(stop()), 'no crash across offline and back').toEqual([]);
    });

    test('a reload while the About save is out brings Settings back and does not resend @ui', async ({
      page,
    }) => {
      let calls = 0;
      await page.route(ABOUT_SAVE, async (route) => {
        calls += 1;
        await delay(20_000);
        await route.fulfill(REFUSAL).catch(() => undefined);
      });
      const { editor, update } = await openAbout(page);
      await editor.fill(`QA resilience about ${Date.now()}`);
      await update.click();
      await expect.poll(() => calls, { message: 'the save request fired' }).toBe(1);
      const stop = watchUiHealth(page);
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 });
      await openAbout(page);
      await expect(page.getByText(BOUNDARY), 'no error boundary after the reload').toHaveCount(0);
      expect(calls, 'the reload must not resend the save').toBe(1);
      expect(stop().pageErrors, 'no uncaught error after the reload').toEqual([]);
    });
  },
);
