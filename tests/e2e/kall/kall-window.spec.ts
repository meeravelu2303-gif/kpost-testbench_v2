import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';
import { settleFrames } from '../support/settle';

/**
 * `/kall-window` checks the token itself and, with no session, shows its own "Unauthorized" screen
 * instead of redirecting. Call data arrives via the opener window, so no call is driven here.
 */
test.describe('KPost — /kall-window (no session)', { tag: ['@ui', '@kall', '@regression'] }, () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('with no session, /kall-window shows its own Unauthorized message, not a crash @ui', async ({
    page,
  }) => {
    const stop = watchUiHealth(page);
    await page.goto('/kall-window', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForLoadState('load');
    await settleFrames(page);

    const health = stop();
    expect(health.pageErrors, 'no uncaught JS error with no session').toEqual([]);
    await expect(
      page.getByText(/Unauthorized/i).first(),
      'an unauthenticated visitor sees the documented Unauthorized message',
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByText(/Please sign in to KPost to use Kall/i).first(),
      'the specific sign-in prompt renders',
    ).toBeVisible();
  });
});
