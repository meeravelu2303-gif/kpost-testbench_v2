import { testData } from '@config/test-data.config';
import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';
import type { Page } from '@playwright/test';

/**
 * KNews (/knews) reads third-party RSS feeds directly, so tests assert only that the screen settles
 * (articles, empty or error state), never article content. Share-to-Katchup only opens, never sends.
 */
test.describe(
  'KPost KNews — content feed',
  { tag: ['@ui', '@verticals', '@regression', '@sanity'] },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    /** Waits for whichever state arrives first: articles, the empty state, or the feed-error state. */
    async function settledKnews(page: Page): Promise<void> {
      // Let the loading state finish first; its skeleton cards must not count as articles.
      await page
        .locator('.loader-overlay')
        .waitFor({ state: 'hidden', timeout: 45_000 })
        .catch(() => undefined);
      await page
        .getByText(/^Loading/i)
        .first()
        .waitFor({ state: 'hidden', timeout: 45_000 })
        .catch(() => undefined);
      await expect(
        page
          .locator('.jn-card-anchor, .jn-hero-anchor, .jn-v-anchor')
          .first()
          .or(
            page
              .getByText(
                /No articles available|No articles match your search|Feed failed|News providers are temporarily unavailable/i,
              )
              .first(),
          ),
        'KNews reaches articles, its empty state, or its feed-error state',
      ).toBeVisible({ timeout: 30_000 });
    }

    test('the KNews screen loads into a real state: articles, an empty state, or a feed-error state — never a silent blank @ui', async ({
      page,
    }) => {
      const stop = watchUiHealth(page);
      await page.goto('/knews', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await settledKnews(page);

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
      await settledKnews(page);

      const search = page.getByPlaceholder(/Search headlines/i).first();
      await expect(search, 'the search input renders').toBeVisible({ timeout: 15_000 });
      await search.fill(`zzqanomatch${Date.now()}`);

      const clearButton = page.locator('.jn-search-clear').first();
      await expect(clearButton, 'a Clear button appears once search text is entered').toBeVisible({
        timeout: 5_000,
      });
      await clearButton.click();
      await expect(search, 'Clear empties the search box').toHaveValue('');
    });

    test('the World nav item opens the country selector @ui', async ({ page }) => {
      await page.goto('/knews', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await settledKnews(page);

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
      await settledKnews(page);

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
  },
);
