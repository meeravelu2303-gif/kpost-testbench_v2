/* eslint-disable playwright/no-wait-for-timeout */
import { testData } from '@config/test-data.config';
import { AUTHENTICATED_SCREENS } from '@ui/screens';
import { healthFailures, isResponsive, watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';
import { skipIfSignedOut } from '../support/session';

/**
 * Keyboard operability: Tab from a fresh screen must reach an interactive control (WCAG 2.1.1), and
 * keyboard use must not crash or freeze the page.
 */
test.describe(
  'KPost keyboard navigation — every screen',
  {
    tag: ['@ui', '@platform', '@regression'],
    annotation: [{ type: 'non-functional', description: 'accessibility' }],
  },
  () => {
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
        expect(healthFailures(health), `${screen.name}: keyboard use crashed the screen`).toEqual(
          [],
        );
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
  },
);
