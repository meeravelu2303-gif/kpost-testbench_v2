import type { Page } from '@playwright/test';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { settleFrames } from '../support/settle';

/**
 * Home Recents: a failing, unreachable or empty `homeDashboardMsgs` response (stubbed) must show an
 * error banner or an empty state, never a silent blank. Success = `status: "SUCCESS"` with
 * `katchup`/`kmail`/`kall` arrays (`RecentMessage.js`).
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
      // KPost's envelope: HTTP 200 carrying a failure.
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
      // The service swallows a transport failure (empty catch in Services/Home.js).
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
      // RecentMessage.js never calls setNodata(true) on an empty SUCCESS, so "No Data found" never shows.
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
