import type { Page } from '@playwright/test';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { settleFrames } from '../support/settle';

/**
 * Home with stubbed bad data: one malformed Recents row must not crash the app to AppErrorBoundary,
 * and an odd unread count must not render as "[object Object]" (`RecentMessage.js`, `Header.js`).
 */
test.describe(
  'KPost Home · resilience to bad API data',
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
    const crashBoundary = (page: Page) =>
      page.locator('[role="alert"]', { hasText: /something went wrong/i });

    test('a malformed Recents item does not crash the entire app (no error boundary) @ui', async ({
      homePage,
      page,
    }) => {
      await page.route(RECENTS, (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 'SUCCESS',
            statusCode: 200,
            serverTime: Date.now(),
            lastMsgID: null,
            katchup: [],
            kmail: [],
            // Crash-shaped Kall rows (RecentMessage.js:3640/3647): empty/missing kallDetails.
            kall: [
              { value: [{ kallType: 0, sender: testData.kpostId, kallDetails: [] }] },
              { value: [{ kallType: 1, subject: 'QA bench', kallDetails: null }] },
            ],
          }),
        }),
      );

      await homePage.goto();
      await homePage.switchToRecentsTab();
      await settleFrames(page);

      const crashed = await crashBoundary(page)
        .first()
        .isVisible()
        .catch(() => false);
      test.info().annotations.push({
        type: 'observed',
        description: crashed
          ? 'AppErrorBoundary shown — a malformed server item crashed the whole app'
          : 'app stayed up under malformed data',
      });
      expect(
        crashed,
        'one malformed item in the dashboard response must not crash the ENTIRE app to the error boundary',
      ).toBe(false);
    });

    test('the unread badges handle a non-numeric/failed count without rendering broken text @ui', async ({
      homePage,
      page,
    }) => {
      // Object counts (what a malformed success body can carry) must not reach the DOM as text.
      await page.route('**/katchup/getUnopenedMessagesCount/**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'SUCCESS', statusCode: 200, msgsCount: {} }),
        }),
      );
      await page.route('**/common/unOpenedMailCountBySenderID/**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'SUCCESS', statusCode: 200, UnOpenedMailCount: {} }),
        }),
      );

      await homePage.goto();
      await settleFrames(page);

      const badgeText = (
        await page
          .locator('.Header_msg_count')
          .allInnerTexts()
          .catch(() => [])
      ).join(' | ');
      const broken = /\[object Object\]|NaN|undefined/i.test(badgeText);
      const crashed = await crashBoundary(page)
        .first()
        .isVisible()
        .catch(() => false);

      test.info().annotations.push({
        type: 'observed',
        description: `badge text: "${badgeText || '(no badge shown)'}"; crashed: ${crashed}`,
      });
      expect(broken, `unread badges must not render a broken value (saw: "${badgeText}")`).toBe(
        false,
      );
      expect(crashed, 'a bad unread-count must not crash the app').toBe(false);
    });
  },
);
