import type { Page } from '@playwright/test';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { settleFrames } from '../support/settle';

/**
 * Home dashboard — API response-handling. Does the Recents list surface a failing/empty backend
 * honestly, or does it silently show a blank list (indistinguishable, to a user, from "you have no
 * messages")?
 *
 * CORRECTED 2026-10-12 (frontend ground-truth re-read of `Services/Home.js` + `RecentMessage.js`):
 * Home's Recents list is loaded from `POST /dashboard/homeDashboardMsgs/` (initial + pagination)
 * and refreshed via `/dashboard/homeDashboardNewMsgs/` — NOT `katchupDashboardMsg` (that belongs to
 * the /katchup route and is never called here). The previous version of this spec stubbed
 * `katchupDashboardMsg`, so it exercised nothing. These stubs hit the real endpoint.
 *
 * Response shape (from `RecentMessage.js:451-473`): a SUCCESS body carries top-level `katchup`,
 * `kmail` and `kall` arrays, merged with `[...response.katchup, ...response.kmail, ...response.kall]`.
 * The component treats `status === "SUCCESS"` as the success gate and shows an error banner otherwise.
 *
 * NEEDS-LIVE-TUNING: the exact success-body fields are from the source map above; confirm on the first
 * run and tune the empty/No-Data assertion if the live markup differs.
 */
test.describe(
  'KPost Home · dashboard API failure handling',
  {
    tag: ['@ui', '@home', '@regression'],
    annotation: [{ type: 'non-functional', description: 'resilience' }],
  },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    const RECENTS = '**/dashboard/homeDashboardMsgs/**';
    const errorBanner = (page: Page) =>
      page.locator('div[role="alert"].alert-danger, .alert.alert-danger', {
        hasText: /could not be refreshed|out of date|error|failed|unable|try again/i,
      });

    test('a failing Recents load (FAILURE envelope) shows the error banner, not a silent-empty list @ui', async ({
      homePage,
      page,
    }) => {
      // KPost's envelope anti-pattern: HTTP 200 carrying a failure. The component gates on
      // status==="SUCCESS", so this must drive the visible error banner.
      await page.route(RECENTS, (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            statusCode: 500,
            status: 'FAILURE',
            message: 'Internal Server Error',
          }),
        }),
      );

      await homePage.goto();
      await homePage.switchToRecentsTab();
      await settleFrames(page);

      const shown = await errorBanner(page)
        .first()
        .waitFor({ state: 'visible', timeout: 8_000 })
        .then(() => true)
        .catch(() => false);
      test.info().annotations.push({
        type: 'observed',
        description: shown
          ? 'error banner shown'
          : 'NO visible error — the dashboard load failed silently',
      });
      expect(
        shown,
        'a failed Recents load must show visible feedback — otherwise an outage is indistinguishable ' +
          'from "this account genuinely has zero messages"',
      ).toBe(true);
    });

    test('a Recents load that never answers (network error) still shows the error banner @ui', async ({
      homePage,
      page,
    }) => {
      // A transport failure returns `undefined` from the service (empty catch in Services/Home.js).
      // The screen must still tell the user, not render a confident-but-false empty list.
      await page.route(RECENTS, (route) => route.abort('failed'));

      await homePage.goto();
      await homePage.switchToRecentsTab();
      await settleFrames(page);

      const shown = await errorBanner(page)
        .first()
        .waitFor({ state: 'visible', timeout: 8_000 })
        .then(() => true)
        .catch(() => false);
      test.info().annotations.push({
        type: 'observed',
        description: shown
          ? 'error banner shown on network error'
          : 'network error produced NO visible feedback',
      });
      expect(
        shown,
        'a Recents load that errors at the network level must surface an error, not a silent blank',
      ).toBe(true);
    });

    test('an empty-but-successful Recents load shows a real empty state, not a confusing blank @ui', async ({
      homePage,
      page,
    }) => {
      // Frontend gap (RecentMessage.js): on an empty SUCCESS, `setNodata(true)` is never called, so the
      // "No Data found" state can never render — the user sees a blank panel with no explanation.
      await page.route(RECENTS, (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            statusCode: 200,
            status: 'SUCCESS',
            serverTime: Date.now(),
            lastMsgID: null,
            katchup: [],
            kmail: [],
            kall: [],
          }),
        }),
      );

      await homePage.goto();
      await homePage.switchToRecentsTab();
      await settleFrames(page);

      // The list must not be a silent blank: either an explicit empty-state message, OR at least no
      // false error banner on a legitimately-empty inbox.
      const emptyState = page.getByText(
        /no (data|messages|recent|conversations) (found|yet|available)|you have no|nothing here/i,
      );
      const emptyShown = await emptyState
        .first()
        .waitFor({ state: 'visible', timeout: 6_000 })
        .then(() => true)
        .catch(() => false);
      const falseError = await errorBanner(page)
        .first()
        .isVisible()
        .catch(() => false);

      test.info().annotations.push({
        type: 'observed',
        description: `empty-state message: ${emptyShown ? 'shown' : 'MISSING'}; false error banner: ${falseError ? 'yes' : 'no'}`,
      });
      expect(
        emptyShown && !falseError,
        'an empty inbox must show a clear "no messages" state (not a blank panel, not a false error)',
      ).toBe(true);
    });
  },
);
