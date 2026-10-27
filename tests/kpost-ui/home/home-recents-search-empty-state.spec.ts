import type { Page } from '@playwright/test';
import { expect, test } from '@fixtures';

/**
 * Home Recents must show a "No Data Found" message, never a blank panel, both for an empty load and
 * for a search filter that matches nothing.
 */
test.describe(
  'KPost Home · Recents shows an empty state, never a silent blank',
  { tag: ['@ui', '@home', '@regression'] },
  () => {
    const itemSel = '.RecentMessage, [class*="recent" i][class*="msg" i], [class*="RecentMessage"]';
    const emptyMsg = (page: Page) =>
      page.getByText(/no data|no result|not found|nothing (found|here)|no recent/i).first();
    const errorBanner = (page: Page) =>
      page.getByText(/unable to|something went wrong|failed to load|please try again/i).first();

    test('an empty Recents list shows a "No Data" message, not a silent blank @ui', async ({
      homePage,
      page,
    }) => {
      await homePage.goto();
      await homePage.expectLoaded();
      await homePage.switchToRecentsTab();
      await page.waitForLoadState('load').catch(() => undefined);
      await page.waitForTimeout(2_000);

      // If the load genuinely errored (not just empty), that is a different case (home-api-handling).
      test.skip(
        await errorBanner(page)
          .isVisible()
          .catch(() => false),
        'Recents shows a load-error state, not an empty state — out of scope for this test',
      );

      const items = await page.locator(itemSel).count();

      if (items > 0) {
        // Case (b): filter to zero matches, then the empty state must appear.
        await homePage.searchRecents('zzqx-no-such-recent-xyz');
        await expect
          .poll(() => page.locator(itemSel).count(), {
            message: 'the non-matching filter empties the visible list',
            timeout: 8_000,
          })
          .toBe(0);
        await expect(
          emptyMsg(page),
          'filtering Recents to zero matches must show a "No Data Found" empty state, not a blank',
        ).toBeVisible({ timeout: 6_000 });
      } else {
        // Case (a): the account has no recents — the user's exact scenario. The empty state must show.
        await expect(
          emptyMsg(page),
          'an empty Recents list must show a "No Data Found" message, not a silent blank panel',
        ).toBeVisible({ timeout: 6_000 });
      }
    });
  },
);
