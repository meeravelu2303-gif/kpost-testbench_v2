import type { Page } from '@playwright/test';
import { TAGS } from '@config/constants';
import { expect, test } from '@fixtures';
import { requireAccounts, requireFlags, waitLoaded } from './support/journey';

/**
 * Journey 8: A edits About and changes the theme; both survive a reload; both are restored.
 * Known defect #810: the old theme swatch keeps a stale "active" class, so only the new one is asserted.
 */
async function openAbout(page: Page) {
  await page.goto('/settings', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await waitLoaded(page);
  await page.getByText('Profile Creation', { exact: true }).first().click({ timeout: 15_000 });
  await page.getByText('About', { exact: true }).first().click({ timeout: 15_000 });
  const field = page.getByPlaceholder('Write about yourself...').first();
  await expect(field, 'the About editor opens').toBeVisible({ timeout: 15_000 });
  return field;
}

async function saveAbout(page: Page, text: string): Promise<void> {
  const field = await openAbout(page);
  await field.click();
  await field.fill(text);
  await page.getByRole('button', { name: 'Update' }).click();
  await expect(page.getByText(text).first(), 'the saved About text shows').toBeVisible({
    timeout: 12_000,
  });
}

async function openThemePicker(page: Page): Promise<void> {
  await page.goto('/settings', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await waitLoaded(page);
  await page.getByText('General Settings', { exact: true }).first().click();
  await page
    .getByText(/^Personalize$/)
    .first()
    .click();
  await page
    .getByText(/^Change Theme$/)
    .first()
    .click();
  await expect(page.locator('.k-color-swatch').first(), 'the theme swatches show').toBeVisible({
    timeout: 15_000,
  });
}

async function applyTheme(page: Page, theme: string): Promise<void> {
  await page.getByRole('button', { name: theme }).first().click();
  await page.getByRole('button', { name: /Apply Theme/i }).click();
}

test.describe(
  'JOURNEY 8 · making the account your own',
  { tag: [TAGS.ui, TAGS.journey, TAGS.profile, TAGS.settings, TAGS.regression] },
  () => {
    test.describe.configure({ timeout: 180_000 });
    requireAccounts('A');
    requireFlags('PROFILE_UI_LIFECYCLE', 'SETTINGS_UI_LIFECYCLE');

    test('A personalizes About and the theme, both survive a reload, both are restored', async ({
      page,
    }) => {
      const marker = `QA journey about ${Date.now()}`;
      let originalAbout: string | undefined;
      let originalTheme: string | undefined;

      try {
        await test.step('A writes a new About and saves it', async () => {
          originalAbout = (await (await openAbout(page)).inputValue().catch(() => '')) || '';
          await saveAbout(page, marker);
        });

        await test.step('after leaving and coming back, the About is still there', async () => {
          await page.goto('/home', { waitUntil: 'domcontentloaded', timeout: 45_000 });
          const field = await openAbout(page);
          await expect(field, 'the About text persisted').toHaveValue(marker, { timeout: 15_000 });
        });

        let targetTheme = '';

        await test.step('A applies another theme', async () => {
          await openThemePicker(page);
          originalTheme =
            (await page.locator('.k-color-swatch--active').first().getAttribute('aria-label')) ??
            '';
          const target = page
            .locator('.k-color-swatch')
            .filter({ hasNot: page.locator('.k-color-swatch-check') })
            .first();
          targetTheme = (await target.getAttribute('aria-label')) ?? '';
          expect(targetTheme, 'another theme is offered').not.toBe('');
          await applyTheme(page, targetTheme);
          await expect(
            page.getByRole('button', { name: targetTheme }),
            'the new theme is active',
          ).toHaveClass(/k-color-swatch--active/, { timeout: 15_000 });
        });

        await test.step('after a reload, the new theme is still active', async () => {
          await page.reload({ waitUntil: 'domcontentloaded' });
          await openThemePicker(page);
          await expect(
            page.getByRole('button', { name: targetTheme }),
            'the theme persisted (#810: the old one may still look active too)',
          ).toHaveClass(/k-color-swatch--active/, { timeout: 15_000 });
        });
      } finally {
        if (originalTheme)
          await openThemePicker(page)
            .then(() => applyTheme(page, originalTheme!))
            .catch(() => undefined);
        if (originalAbout !== undefined)
          await openAbout(page)
            .then(async (field) => {
              await field.fill(originalAbout!);
              await page.getByRole('button', { name: 'Update' }).click();
            })
            .catch(() => undefined);
      }
    });
  },
);
