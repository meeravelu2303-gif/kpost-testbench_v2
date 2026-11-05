import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Settings › Personalize › KPost Layout Theme: switch to a different swatch, then restore the original.
 * Writes a preference, so gated behind SETTINGS_UI_LIFECYCLE=true.
 */
test.describe(
  'KPost Settings · Personalize theme (write)',
  { tag: ['@ui', '@settings', '@regression'] },
  () => {
    test.skip(
      process.env.SETTINGS_UI_LIFECYCLE !== 'true',
      'changes a real (cosmetic) preference; set SETTINGS_UI_LIFECYCLE=true',
    );
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    test('change the layout theme through the UI, verify it applies, then restore the original @ui', async ({
      page,
    }) => {
      await page.goto('/settings', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page
        .locator('.loader-overlay')
        .waitFor({ state: 'hidden', timeout: 30_000 })
        .catch(() => undefined);

      // "Personalize" is nested under the collapsed "General Settings" group.
      await page.getByText('General Settings', { exact: true }).first().click();
      await page
        .getByText(/^Personalize$/)
        .first()
        .click();
      // Personalize opens on its "Change Language" tab by default; the swatches live under "Change Theme".
      await page
        .getByText(/^Change Theme$/)
        .first()
        .click();

      // The layout-theme swatches: real buttons with an aria-label = the theme name.
      const swatches = page.locator('.k-color-swatch');
      await expect(swatches.first(), 'the layout-theme swatches render').toBeVisible({
        timeout: 20_000,
      });

      // Read the current theme so it can be restored (do not assume which one it is).
      const activeSwatch = page.locator('.k-color-swatch--active').first();
      await expect(activeSwatch, 'a theme is currently selected').toBeVisible({ timeout: 10_000 });
      const originalTheme = (await activeSwatch.getAttribute('aria-label')) ?? '';
      expect(originalTheme, 'the active swatch names its theme').not.toBe('');

      // Pick a DIFFERENT swatch (the first one that is not the active one).
      const target = swatches.filter({ hasNot: page.locator('.k-color-swatch-check') }).first();
      const targetTheme = (await target.getAttribute('aria-label')) ?? '';
      expect(targetTheme, 'a different theme is available to switch to').not.toBe('');
      await target.click();
      await page.getByRole('button', { name: /Apply Theme/i }).click();

      // The "Katchup Preview" panel is the source of truth. Known defect #810: the previous swatch keeps
      // a stale --active class, so exactly-one-active-swatch cannot be asserted.
      await expect(
        page
          .getByText(new RegExp(targetTheme.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), {
            exact: false,
          })
          .first(),
        'the Katchup Preview reflects the newly-applied theme',
      ).toBeVisible({ timeout: 15_000 });
      // Re-locate by the captured name: the `target` filter re-evaluates against the changed checkmark
      // and would drift to another swatch.
      await expect(
        page.getByRole('button', { name: targetTheme }),
        'the chosen swatch is marked active (even if a stale one also is - #810)',
      ).toHaveClass(/k-color-swatch--active/, { timeout: 15_000 });

      // Restore: switch back to the original theme and re-apply, so the account ends as it started.
      await page.getByRole('button', { name: originalTheme }).first().click();
      await page.getByRole('button', { name: /Apply Theme/i }).click();
      await expect(
        page
          .getByText(new RegExp(originalTheme.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), {
            exact: false,
          })
          .first(),
        'the Katchup Preview reflects the restored original theme',
      ).toBeVisible({ timeout: 15_000 });
    });
  },
);
