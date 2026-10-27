import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * /userprofile actions: the three-dot menu, the Share modal (read-only) and the Experience add modal
 * (gated behind PROFILE_UI_LIFECYCLE).
 */
test.describe(
  'KPost Profile — actions (read-only)',
  { tag: ['@ui', '@profile', '@regression'] },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    test('the three-dot menu opens its options (Change Picture / Share / Logout) @ui', async ({
      page,
    }) => {
      await page.goto('/userprofile', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page
        .locator('.loader-overlay')
        .waitFor({ state: 'hidden', timeout: 30_000 })
        .catch(() => undefined);

      await page.locator('.icon-KP_144---More-Vertical').first().click();
      await expect(
        page.getByText(/Change (Cover|Profile) Picture|Share|Logout/i).first(),
        'the three-dot menu reveals its profile actions',
      ).toBeVisible({ timeout: 15_000 });
    });

    test('the profile shows the editable About / Experience / Education sections @ui', async ({
      page,
    }) => {
      await page.goto('/userprofile', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page
        .locator('.loader-overlay')
        .waitFor({ state: 'hidden', timeout: 30_000 })
        .catch(() => undefined);

      await expect(page.locator('#About').first(), 'the About section renders').toBeVisible({
        timeout: 20_000,
      });
      await expect(
        page.locator('#Experience, #Education').first(),
        'the Experience / Education sections render',
      ).toBeVisible({ timeout: 20_000 });
    });
  },
);

test.describe(
  'KPost Profile · add an Experience record (write)',
  { tag: ['@ui', '@profile', '@regression'] },
  () => {
    test.skip(
      process.env.PROFILE_UI_LIFECYCLE !== 'true',
      'writes a profile record; set PROFILE_UI_LIFECYCLE=true',
    );
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account',
    );

    // Fragile selector: the hover-revealed .icon-KP_45-Add may differ on the deployed build.
    test('open the Experience add modal from the section @ui', async ({ page }) => {
      await page.goto('/userprofile', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page
        .locator('.loader-overlay')
        .waitFor({ state: 'hidden', timeout: 30_000 })
        .catch(() => undefined);

      // Select the Experience tab so its section becomes visible.
      await page
        .getByRole('tab', { name: /Experience/i })
        .first()
        .click()
        .catch(() => undefined);
      const section = page.locator('#Experience').first();
      await expect(section, 'the Experience section renders').toBeVisible({ timeout: 20_000 });
      // The add icon is hover-revealed; hover the section first, then force the small-icon click.
      await section.hover();
      await section.locator('.icon-KP_45-Add').first().click({ force: true });

      // .first() wraps the combined .or(), or it can still match two elements.
      await expect(
        page.getByRole('dialog').or(page.locator('.modal-content')).first(),
        'the Experience add modal opens',
      ).toBeVisible({ timeout: 15_000 });
    });
  },
);
