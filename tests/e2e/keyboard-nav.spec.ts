/* eslint-disable playwright/no-conditional-in-test, playwright/no-wait-for-timeout */
import { testData } from '@config/test-data.config';
import { AUTHENTICATED_SCREENS } from '@ui/screens';
import { healthFailures, isResponsive, watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';
import { skipIfSignedOut } from './support/session';

/**
 * Keyboard-operability angle — can a keyboard-only user reach the app's controls, and does driving
 * it from the keyboard ever crash or freeze it?
 *
 * The signals are SELECTOR-INDEPENDENT, so they never false-file: pressing Tab repeatedly from a
 * freshly loaded screen must move focus INTO an interactive control (not stay stuck on <body>) —
 * a screen you cannot Tab into is a real WCAG 2.1.1 (Keyboard) defect — and the whole sequence runs
 * under the health monitor + responsiveness probe, so a JS crash or a frozen main thread during
 * keyboard use is caught. Files to KPost UI → Ayyappan (see UI_FILING_SPECS).
 */
test.describe('KPost keyboard navigation — every screen', { tag: '@ui' }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real account (QA_KPOST_ID)',
  );
  test.beforeEach(async ({ page }) => {
    await skipIfSignedOut(page);
  });

  for (const screen of AUTHENTICATED_SCREENS) {
    test(`${screen.name} — keyboard reachable, no crash/freeze on Tab @ui`, async ({ page }) => {
      const stop = watchUiHealth(page);
      await page.goto(screen.route, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForTimeout(1200); // let the SPA settle its focusable content

      // Tab a handful of times and record whether focus ever lands on an interactive element.
      let reachedInteractive = false;
      const interactive = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA']);
      for (let i = 0; i < 12; i += 1) {
        await page.keyboard.press('Tab');
        const active = await page.evaluate(() => {
          const el = document.activeElement;
          return el
            ? {
                tag: el.tagName,
                editable: (el as HTMLElement).isContentEditable,
                tabindex: el.getAttribute('tabindex'),
              }
            : { tag: 'NONE', editable: false, tabindex: null };
        });
        if (interactive.has(active.tag) || active.editable || (active.tabindex ?? '') !== '') {
          reachedInteractive = true;
          break;
        }
      }
      // Escape must not blow up either (closes menus/dialogs).
      await page.keyboard.press('Escape').catch(() => undefined);

      const health = stop();
      expect(healthFailures(health), `${screen.name}: keyboard use crashed the screen`).toEqual([]);
      expect(
        await isResponsive(page),
        `${screen.name}: the screen froze during keyboard navigation`,
      ).toBe(true);
      expect(
        reachedInteractive,
        `${screen.name}: Tab never reaches an interactive control — the screen is not keyboard-operable (WCAG 2.1.1)`,
      ).toBe(true);
    });
  }
});
