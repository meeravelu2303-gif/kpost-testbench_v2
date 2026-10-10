import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * **Settings → Personalize → KPost Layout Theme** driven through the UI — the safest write the bench
 * makes: cosmetic, on the caller's OWN account, and **self-restoring** (it puts the original theme
 * back). It is the UI analogue of the API `changeTheme` lifecycle (already 2/2 green on live).
 *
 * Selectors are mined from `Settings/Personalize/Personalize.js` and are unusually stable for this app
 * — the swatches are real `<button class="k-color-swatch" aria-label="<theme name>">`, the selected
 * one carries `k-color-swatch--active` and a `✓` (`.k-color-swatch-check`), and the commit button is
 * labelled **"Apply Theme"**. So this needs little tuning, but it still WRITES a preference, so it is
 * gated behind `SETTINGS_UI_LIFECYCLE=true` and never runs on a default run.
 *
 * Self-restore is by reading the CURRENT active swatch first (not hard-coding a theme), switching to a
 * different one, then switching back — so whatever the account's theme is, the run leaves it unchanged.
 */
test.describe('KPost Settings · Personalize theme (write)', { tag: '@ui' }, () => {
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

    // "Personalize" is nested under the collapsed "General Settings" group (confirmed live and in
    // settings-sections.spec.ts) — expand it first, then open Personalize.
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

    // Read the CURRENT theme so we can restore it (do not assume which one it is). This is a genuine
    // value READ (needed to switch back later), not an assertion, so getAttribute is correct here.
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

    // The chosen theme is now active. The "Katchup Preview" panel is the source of truth for what
    // actually got applied (see #810: the previous swatch keeps a stale --active class after applying a
    // new one, so exactly-one-active-swatch cannot be asserted here — that staleness is the tracked bug).
    await expect(
      page
        .getByText(new RegExp(targetTheme.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), { exact: false })
        .first(),
      'the Katchup Preview reflects the newly-applied theme',
    ).toBeVisible({ timeout: 15_000 });
    // Re-locate by the captured theme name (not the `target` filter-locator, which re-evaluates against
    // the now-changed checkmark state and would drift to a different swatch entirely).
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
});
