import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';

/**
 * `/digital-card/:id` (`GloabalDigitalCard.js`) — a PUBLIC, read-only shareable digital business
 * card, no auth required. Calls the same public `POST /v2/profile/shareUserDetails/` as
 * `ProfileWebView.js`. Confirmed source INCONSISTENCY worth documenting directly: unlike
 * ProfileWebView (which cleanly redirects to `/not-found` on a bad id), this component has no
 * equivalent handling — a failed fetch just leaves `contactData` as `{}`, silently degrading to a
 * near-blank card (placeholder avatar, name "-") rather than any explicit not-found state. Whether
 * that degraded state is the intended design for a "card" (vs. a full profile page) isn't something
 * to assume either way — this test asserts the one thing that's unambiguously correct (no crash) and
 * records the degraded-render behavior as an observation for a product-owner call, not a hard failure.
 */
test.describe('KPost — /digital-card/:id public digital card', { tag: '@ui' }, () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('an invalid/unknown id does not crash the page @ui', async ({ page }) => {
    const stop = watchUiHealth(page);
    await page.goto('/digital-card/definitely-not-a-real-id', {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    });
    await page.waitForTimeout(2_000);

    const health = stop();
    expect(health.pageErrors, 'no uncaught JS error on an invalid id').toEqual([]);

    const degradedToBlankCard = await page.getByText('-', { exact: true }).first().isVisible({
      timeout: 3_000,
    }).catch(() => false);
    const redirectedToNotFound = /not-found/.test(page.url());

    test.info().annotations.push({
      type: 'observed',
      description:
        `degraded to a near-blank card: ${degradedToBlankCard}; redirected to /not-found: ` +
        `${redirectedToNotFound} — unlike ProfileWebView, GloabalDigitalCard.js has no confirmed ` +
        'not-found handling for a bad id; whether the blank-card degrade is intentional for a ' +
        '"card" format is a product-owner question, not assumed here',
    });
  });
});
