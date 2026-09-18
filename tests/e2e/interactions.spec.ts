/* eslint-disable playwright/no-conditional-in-test */
/* eslint-disable playwright/no-wait-for-timeout -- the short settle waits here are deliberate: a
   search filter and a scroll re-render need a beat to run so a hang/crash can surface. */
import { testData } from '@config/test-data.config';
import { AUTHENTICATED_SCREENS } from '@ui/screens';
import { failedUserActions, healthFailures, isResponsive, watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';
import type { Page } from '@playwright/test';
import { skipIfSignedOut } from './support/session';

/**
 * INTERACTION sweep — the counterpart to the read-only screen sweep (`screens.spec.ts`).
 *
 * The screen sweep loads each screen and checks it at rest. But the defects a user actually hits live
 * in USE, not on load: a search box that hangs the tab, a click that crashes the app, a page that
 * freezes after an action. This drives real (non-destructive) interactions on every screen — type in
 * the search box, scroll the list, open a conversation, press Escape — while the health monitor and a
 * hang detector watch, and files the unambiguous defects:
 *
 *   - a JS crash triggered by the interaction (`pageErrors`),
 *   - the app's own asset failing to load during the flow (`brokenResources`),
 *   - the page freezing — its main thread stops responding after an action (`isResponsive` = false).
 *
 * These are selector-INDEPENDENT signals: every interaction is best-effort (a missing control is
 * skipped, never failed), so a tuning gap can never file a false bug — only a real crash / freeze
 * does. Runs on Chromium, Firefox and WebKit (via `npm run ui`), so a browser-specific freeze/crash
 * is caught and the ticket names the browser. Read-only: it types, scrolls and opens, never writes.
 */

/** Try an interaction; a missing element / timeout is skipped, not failed (no false positives). */
async function attempt(label: string, fn: () => Promise<void>): Promise<string | undefined> {
  try {
    await fn();
    return undefined;
  } catch {
    return label; // the interaction could not be performed here — reported as skipped, never filed
  }
}

/** Common search-box selectors on this icon-font, test-id-less SPA (best-effort). */
const SEARCH_SELECTORS = [
  'input[type="search"]',
  'input[placeholder*="search" i]',
  'input[placeholder*="Search" i]',
  '[class*="search" i] input',
  '.search-input',
];

async function drive(page: Page): Promise<string[]> {
  const skipped: string[] = [];

  // 1. Search: the box the owner reported as flaky. Type a query, let it filter, then clear — a
  //    crash or a freeze here is exactly the "search bar not working / screen hangs" class.
  const search = page.locator(SEARCH_SELECTORS.join(', ')).first();
  const s = await attempt('search', async () => {
    await search.waitFor({ state: 'visible', timeout: 5000 });
    await search.click();
    await search.fill('qa');
    await page.waitForTimeout(1200); // let the filter run
    await search.fill('');
    await page.waitForTimeout(400);
  });
  if (s) skipped.push(s);

  // 2. Scroll the main content — long lists that re-render on scroll are a common freeze trigger.
  const scroll = await attempt('scroll', async () => {
    await page.mouse.wheel(0, 1600);
    await page.waitForTimeout(300);
    await page.mouse.wheel(0, -1600);
  });
  if (scroll) skipped.push(scroll);

  // 3. Open the first conversation/list row (read-only) — opening a thread is where render/JS bugs
  //    and hangs often surface. Best-effort: a plain list item, no destructive control.
  const openRow = await attempt('open-row', async () => {
    const row = page
      .locator('[id*="@"], [class*="conversation" i], [class*="contact" i] li, [role="listitem"]')
      .first();
    await row.waitFor({ state: 'visible', timeout: 4000 });
    await row.click({ timeout: 4000 });
    await page.waitForTimeout(800);
  });
  if (openRow) skipped.push(openRow);

  // 4. Escape closes any modal/menu the clicks opened, returning the screen to rest.
  await attempt('escape', async () => {
    await page.keyboard.press('Escape');
  });

  return skipped;
}

test.describe('KPost UI interaction sweep — search, scroll, open, freeze', { tag: '@ui' }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  test.beforeEach(async ({ page }) => {
    await skipIfSignedOut(page);
  });

  // The interactive screens — the ones with a search box / list / thread a user drives.
  const INTERACTIVE = new Set(['home', 'katchup', 'kall', 'kmail', 'settings']);
  for (const screen of AUTHENTICATED_SCREENS.filter((s) => INTERACTIVE.has(s.name.toLowerCase()))) {
    test(`${screen.name} — interact without crashing or freezing @ui`, async ({ page }) => {
      const stop = watchUiHealth(page);

      await page.goto(screen.route, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await expect(
        page.locator(screen.ready.join(', ')).first(),
        `${screen.name} mounted`,
      ).toBeVisible({ timeout: 20_000 });

      const skipped = await drive(page);

      // After the interactions, is the page still alive and responsive — or frozen?
      const responsive = await isResponsive(page);
      const health = stop();

      if (skipped.length) {
        console.log(`[ui-interaction] ${screen.name}: not performed here — ${skipped.join(', ')}`);
      }
      for (const c of failedUserActions(health)) {
        console.log(`[ui-interaction] ${screen.name}: action call failed ${c.status} ${c.url}`);
      }

      // The fileable defects — a crash, a broken asset, or a freeze during real use.
      const problems = [
        ...healthFailures(health),
        ...(responsive ? [] : [`the screen FROZE (main thread unresponsive) after interacting`]),
      ];
      expect(problems, `${screen.name} broke during interaction — ${problems.join(' | ')}`).toEqual(
        [],
      );
    });
  }
});
