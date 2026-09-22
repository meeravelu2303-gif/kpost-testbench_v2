import { testData } from '@config/test-data.config';
import { sweepScreen } from '@ui/breakage-sweep';
import { expect, test } from '@fixtures';
import type { Page } from '@playwright/test';

/**
 * Contacts **screen-breakage** sweep — does the Contacts experience crash?
 *
 * Contacts lives as a tab in the Katchup rail, with deep sub-surfaces captured from a live codegen
 * pass: the **Add-User / KDirectory** wizard (`.icon-KP_107-User-Add`, the "…More" → KDirectory
 * menu) and the **Create-Group** dialog (`.icon-KP_112-Group-Add`). Each is a place a broken bundle,
 * a 404 asset or an uncaught exception bites a real user. This opens each one (open only — no add, no
 * create, no message) and, via the shared sweep, captures short readable proof if anything crashes.
 *
 * Read-only by design; runs on any authenticated UI run.
 */

/** Open an icon-triggered surface, then dismiss it so the walk can continue. Never fails the walk. */
async function poke(page: Page, selector: string): Promise<void> {
  await page
    .locator(selector)
    .first()
    .click({ timeout: 8_000 })
    .catch(() => undefined);
  await page.waitForLoadState('load', { timeout: 6_000 }).catch(() => undefined);
  await page.keyboard.press('Escape').catch(() => undefined);
}

test.describe('KPost Contacts · screen-breakage sweep @ui', { tag: '@ui' }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  test('the Contacts tab and its Add/KDirectory/Group surfaces load without a crash @ui', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await sweepScreen(page, {
      screen: 'Contacts',
      route: '/katchup',
      arrive: async () => {
        await page.goto('/katchup', { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await page
          .locator('.loader-overlay')
          .waitFor({ state: 'hidden', timeout: 30_000 })
          .catch(() => undefined);
        await page
          .getByRole('tab', { name: 'Contacts' })
          .click({ timeout: 15_000 })
          .catch(() => undefined);
      },
      mount: async () => {
        await expect(
          page.getByRole('searchbox', { name: 'Search' }).first(),
          'Contacts tab mounted',
        ).toBeVisible({ timeout: 20_000 });
      },
      walk: async () => {
        // The deep contact surfaces — open only.
        await poke(page, '.icon-KP_107-User-Add'); // Add a contact wizard
        await poke(page, '.icon-KP_112-Group-Add'); // Create group dialog
        await poke(page, '.icon-KP_144---More-Vertical'); // "…More" (Invite / KDirectory) menu
      },
    });
  });
});
