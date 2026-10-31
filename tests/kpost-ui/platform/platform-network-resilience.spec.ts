/* eslint-disable playwright/no-wait-for-timeout */
import { testData } from '@config/test-data.config';
import { AUTHENTICATED_SCREENS } from '@ui/screens';
import { healthFailures, isResponsive, watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';
import { skipIfSignedOut } from '../support/session';

/**
 * Network resilience: load a screen, go offline, interact, and fail only on an uncaught error or a
 * frozen main thread. A graceful "offline" state passes.
 */
test.describe(
  'KPost network resilience — offline mid-session',
  {
    tag: ['@ui', '@platform', '@regression'],
    annotation: [{ type: 'non-functional', description: 'resilience' }],
  },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real account (QA_KPOST_ID)',
    );

    test.beforeEach(async ({ page }) => {
      await skipIfSignedOut(page);
    });

    // A representative slice across the modules (a full 20-screen offline sweep adds little over these).
    const SCREENS = AUTHENTICATED_SCREENS.filter((s) =>
      /home|katchup|kall|kmail|settings|userprofile/i.test(s.route),
    );

    for (const screen of SCREENS) {
      test(`${screen.name} — no crash/freeze when the network drops @ui`, async ({ page }) => {
        const stop = watchUiHealth(page);
        await page.goto(screen.route, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await page.waitForTimeout(1000);

        // Cut the network, then drive real use: click a nav destination, scroll, type in any input.
        await page.context().setOffline(true);
        try {
          await page.mouse.wheel(0, 600).catch(() => undefined);
          const anyInput = page.locator('input:visible, [contenteditable="true"]').first();
          if (await anyInput.count())
            await anyInput.click({ timeout: 3000 }).catch(() => undefined);
          await page.keyboard.type('offline probe').catch(() => undefined);
          await page.waitForTimeout(1500);
          // The offline state must not have crashed or frozen the tab.
          const health = stop();
          expect(
            healthFailures(health),
            `${screen.name}: the screen crashed when the network dropped`,
          ).toEqual([]);
          expect(
            await isResponsive(page),
            `${screen.name}: the screen froze when the network dropped (main thread hung)`,
          ).toBe(true);
        } finally {
          await page.context().setOffline(false);
        }
      });
    }
  },
);
