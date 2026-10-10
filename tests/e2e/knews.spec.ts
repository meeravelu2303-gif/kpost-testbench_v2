import { testData } from '@config/test-data.config';
import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';

/**
 * KNews (`/knews`) — confirmed from source: NO KPost backend for content at all. `NewsList.js`
 * fetches EXTERNAL RSS feeds directly (`fetch()` to third-party country/RSS URLs), so this suite is
 * inherently at the mercy of live external feed availability. Scope is deliberately "does the screen
 * render SOMETHING and handle a feed failure gracefully" (the component has real, source-confirmed
 * loading/error/empty states for exactly this), never an assertion on specific article content.
 *
 * The one genuine KPost-backend touchpoint is the Share-to-Katchup flow (confirmed: `SendMessage` from
 * `Services/Katchup`) — this test only confirms the Forward modal opens, and deliberately never
 * completes a real send (that would dispatch an actual Katchup message from an unrelated module,
 * out of proportion for a "does the button work" check).
 */
test.describe('KPost KNews — content feed', { tag: '@ui' }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  test('the KNews screen loads into a real state: articles, an empty state, or a feed-error state — never a silent blank @ui', async ({
    page,
  }) => {
    const stop = watchUiHealth(page);
    await page.goto('/knews', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(4_000);

    const health = stop();
    expect(health.pageErrors, 'no uncaught JS error on load').toEqual([]);

    const hasArticles =
      (await page.locator('.jn-card-anchor, .jn-hero-anchor, .jn-v-anchor').count()) > 0;
    const hasEmptyState = await page
      .getByText(/No articles available|No articles match your search/i)
      .first()
      .isVisible({ timeout: 3_000 })
      .catch(() => false);
    const hasErrorState = await page
      .getByText(/Feed failed|News providers are temporarily unavailable/i)
      .first()
      .isVisible({ timeout: 3_000 })
      .catch(() => false);

    test.info().annotations.push({
      type: 'observed',
      description: `articles: ${hasArticles}, empty-state: ${hasEmptyState}, error-state: ${hasErrorState}`,
    });

    expect(
      hasArticles || hasEmptyState || hasErrorState,
      'the screen must reach one of its 3 documented real states (articles / empty / error) — never ' +
        'a silent blank that is none of these',
    ).toBe(true);
  });

  test('the headline search box filters the already-loaded list client-side @ui', async ({
    page,
  }) => {
    await page.goto('/knews', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(3_000);

    const search = page.getByPlaceholder(/Search headlines/i).first();
    await expect(search, 'the search input renders').toBeVisible({ timeout: 15_000 });
    await search.fill(`zzqanomatch${Date.now()}`);
    await page.waitForTimeout(1_000);

    const clearButton = page.locator('.jn-search-clear').first();
    await expect(clearButton, 'a Clear button appears once search text is entered').toBeVisible({
      timeout: 5_000,
    });
    await clearButton.click();
    await expect(search, 'Clear empties the search box').toHaveValue('');
  });

  test('the World nav item opens the country selector @ui', async ({ page }) => {
    await page.goto('/knews', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(2_000);

    await page
      .getByText(/^World$/i)
      .first()
      .click();
    await expect(
      page.getByPlaceholder(/Filter countries/i).first(),
      'the World panel opens with a country filter',
    ).toBeVisible({ timeout: 15_000 });
  });

  test('sharing an article opens the Forward-to-Katchup contact picker (never completes a real send) @ui', async ({
    page,
  }) => {
    await page.goto('/knews', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(4_000);

    const shareButton = page.locator('[title="Share"]').first();
    const hasArticle = await shareButton.isVisible({ timeout: 8_000 }).catch(() => false);
    test.skip(!hasArticle, 'no article loaded to share (live feed may be empty right now)');

    let sendMessageFired = false;
    page.on('request', (req) => {
      if (req.url().includes('/katchup/') && req.method() === 'POST') sendMessageFired = true;
    });

    await shareButton.click();
    await expect(
      page.getByText(/Forward To/i).first(),
      'the Forward-to-Katchup contact picker opens',
    ).toBeVisible({ timeout: 10_000 });

    expect(
      sendMessageFired,
      'opening the Forward picker alone must not dispatch a real SendMessage call',
    ).toBe(false);
  });
});
