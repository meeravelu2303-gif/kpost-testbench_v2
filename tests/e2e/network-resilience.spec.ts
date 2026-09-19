/* eslint-disable playwright/no-conditional-in-test, playwright/no-wait-for-timeout */
import { testData } from '@config/test-data.config';
import { AUTHENTICATED_SCREENS } from '@ui/screens';
import { healthFailures, isResponsive, watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';
import { skipIfSignedOut } from './support/session';

/**
 * Network-resilience angle — when the connection drops mid-session (a phone in a lift, flaky wifi),
 * does the app degrade gracefully, or does it CRASH / FREEZE? This is close to the owner's reported
 * "can't send a second message without refreshing" class: a screen wedged after a failed request.
 *
 * Selector-INDEPENDENT signals only: the screen is loaded online, the network is cut
 * (`context.setOffline`), then a real interaction is driven — and the check is that the page did not
 * throw an uncaught error and did not freeze the main thread. A graceful "offline" state passes; a
 * white-screen crash or a hung tab fails. Files to KPost UI → Ayyappan.
 */
test.describe('KPost network resilience — offline mid-session', { tag: '@ui' }, () => {
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
        if (await anyInput.count()) await anyInput.click({ timeout: 3000 }).catch(() => undefined);
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
});
