import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';

/**
 * `/kall-window` (`KallWindow.js`) — listed as a public/no-redirect route in `MenuRoutes.js`, but
 * confirmed from source to be AUTH-GATED AT THE COMPONENT LEVEL: it checks
 * `localStorage.accessToken`/the JWT `exp` claim itself and renders its own "Unauthorized" screen
 * rather than relying on the router-level redirect (so it can show that message in-page instead of
 * being bounced to `/login`). With no session, a stranger hitting this URL directly only ever reaches
 * the harmless Unauthorized state — no live-call functionality is exposed. Real call data comes from
 * a `BroadcastChannel`/`window.opener` (same-origin popup pattern, not fetchable directly), so this
 * suite never attempts to drive an actual call session.
 */
test.describe('KPost — /kall-window (no session)', { tag: '@ui' }, () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('with no session, /kall-window shows its own Unauthorized message, not a crash @ui', async ({
    page,
  }) => {
    const stop = watchUiHealth(page);
    await page.goto('/kall-window', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(2_000);

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
