import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import type { Response } from '@playwright/test';
import { skipIfSignedOut } from '../../support/session';

/**
 * KNews must actually show news. The screen reads the backend aggregator (fetchNewsApi,
 * Services/KNews.js:601-638: GET /v1/news or /v1/news/feeds/:id/articles → `{items, failedFeeds}`)
 * and renders article anchors `.jn-hero-anchor` / `.jn-v-anchor` / `.jn-card-anchor`
 * (NewsList.js:367/418/465). knews-functional.spec.ts accepts the empty state as a pass, so it
 * cannot catch a silent empty feed; this test does:
 *
 * - the API answers with no items AND no failed feeds, and the screen shows no article → FAIL
 *   (nothing told the user why; the feed store is simply empty);
 * - the API returns items → the screen must render them (never "No articles available.");
 * - the API names failed feeds and returns nothing → SKIPPED: an upstream provider failed and the
 *   screen says so (the feed-error state, NewsList.js:1078-1084);
 * - no answer at all → SKIPPED (not re-checked).
 */
test.describe(
  'KPost KNews — the feed shows articles',
  { tag: ['@ui', '@verticals', '@regression'] },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    test.beforeEach(async ({ page }) => {
      await skipIfSignedOut(page);
    });

    const ARTICLES = '.jn-card-anchor, .jn-hero-anchor, .jn-v-anchor';
    const isNewsRead = (r: Response) =>
      r.request().method() === 'GET' &&
      /\/v1\/news(\/feeds\/[^/]+\/articles)?$/.test(new URL(r.url()).pathname);

    test('KNews renders articles, and never a silent empty feed when no provider failed @ui', async ({
      page,
    }) => {
      const answer = page.waitForResponse(isNewsRead, { timeout: 45_000 }).catch(() => undefined);
      await page.goto('/knews', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      const response = await answer;
      test.skip(!response, 'the KNews API never answered (not re-checked)');

      const status = response!.status();
      const payload = (await response!.json().catch(() => undefined)) as
        Record<string, unknown> | undefined;
      const body = (payload?.data && typeof payload.data === 'object' ? payload.data : payload) as
        { items?: unknown[]; Items?: unknown[]; failedFeeds?: unknown[] } | undefined;
      const items = Array.isArray(body?.items)
        ? body.items
        : Array.isArray(body?.Items)
          ? body.Items
          : [];
      const failedFeeds = Array.isArray(body?.failedFeeds) ? body.failedFeeds : [];

      // Let the screen settle into articles or one of its empty / error states.
      await page
        .getByText(/^Loading/i)
        .first()
        .waitFor({ state: 'hidden', timeout: 30_000 })
        .catch(() => undefined);
      await page
        .locator(ARTICLES)
        .first()
        .or(
          page
            .getByText(
              /No articles available|No articles match your search|Feed failed|News providers are temporarily unavailable/i,
            )
            .first(),
        )
        .waitFor({ state: 'visible', timeout: 30_000 })
        .catch(() => undefined);
      const shown = await page.locator(ARTICLES).count();
      const emptyState = await page
        .getByText(/No articles available/i)
        .first()
        .isVisible()
        .catch(() => false);

      test.info().annotations.push({
        type: 'observed',
        description: `GET ${new URL(response!.url()).pathname} → HTTP ${status}, ${items.length} item(s), ${failedFeeds.length} failed feed(s); ${shown} article(s) on screen; empty state shown: ${emptyState}`,
      });

      expect(status, `the KNews API answers successfully (HTTP ${status})`).toBe(200);
      test.skip(
        !items.length && failedFeeds.length > 0,
        `an upstream provider failed (${failedFeeds.length} failed feed(s)) and the screen reports it; not a silent empty feed`,
      );

      expect(
        items.length,
        'GET /v1/news returned no articles and named no failed feed: the news feed is silently empty, so KNews shows the user nothing',
      ).toBeGreaterThan(0);
      expect(
        shown,
        `the API returned ${items.length} article(s) but the KNews screen renders none`,
      ).toBeGreaterThan(0);
      expect
        .soft(emptyState, 'the "No articles available." state is not shown while articles exist')
        .toBe(false);
    });
  },
);
