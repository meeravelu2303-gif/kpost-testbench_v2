import { AUTHENTICATED_SCREENS, PUBLIC_SCREENS } from '@ui/screens';
import type { ScreenDef } from '@ui/screens';
import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';
import type { Page } from '@playwright/test';
import { skipIfSignedOut } from './support/session';

/**
 * **Responsive sweep** — every registered screen at phone and tablet widths (the cross-cutting test
 * type the production plan listed as absent, Phase 4).
 *
 * What a screen must do at a small width: mount (its `ready` selectors appear), never make the PAGE
 * scroll sideways (`document.documentElement.scrollWidth` must not exceed the viewport — a sideways
 * scroll on a phone is the classic broken-layout symptom), and raise no uncaught error.
 *
 * One test per viewport, looping the screens, so a shared root cause (the header that overflows at
 * 1280px, decision log 2026-10-09) produces ONE failure listing every affected screen rather than a
 * flood of identical tickets. Screens are paced 4 s apart (the 2026-10-07 rate-limiter lesson).
 */
const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 820, height: 1180 },
] as const;

type Row = { screen: string; mounted: boolean; overflowPx: number; errors: number };

async function measure(page: Page, screen: ScreenDef): Promise<Row> {
  const stop = watchUiHealth(page);
  await page.goto(screen.route, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page
    .locator('.loader-overlay')
    .waitFor({ state: 'hidden', timeout: 30_000 })
    .catch(() => undefined);
  // The registry's `ready` selectors describe the desktop shell (side-menu icons, header), which a
  // phone layout legitimately hides. "Mounted" at a small width therefore means: the route was kept
  // (no bounce to /login), the error boundary is not showing, and the screen rendered real content —
  // with the desktop `ready` selectors as the quick path when they are present.
  const readyVisible = await page
    .locator(screen.ready.join(', '))
    .first()
    .isVisible({ timeout: 10_000 })
    .catch(() => false);
  const generic = await page.evaluate(() => {
    const text = document.body.innerText.trim();
    return {
      boundary: /Something went wrong/i.test(text),
      textLength: text.length,
      hasForm: document.querySelectorAll('input, button, a, [role="button"]').length > 0,
    };
  });
  const routeKept = new RegExp(screen.route.replace(/[/-]/g, '\\$&')).test(page.url());
  // An empty merchant grid or poster feed renders very little text, so any rendered text counts.
  const mounted = routeKept && !generic.boundary && (readyVisible || generic.textLength > 0);
  const overflowPx = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  const health = stop();
  return {
    screen: screen.name,
    mounted,
    overflowPx: Math.max(0, overflowPx),
    errors: health.pageErrors.length,
  };
}

function report(rows: Row[], viewport: string, width: number): void {
  const table = rows
    .map((r) => `${r.screen}: mounted=${r.mounted} overflow=${r.overflowPx}px errors=${r.errors}`)
    .join('\n');
  test
    .info()
    .annotations.push({ type: 'observed', description: `${viewport} ${width}px\n${table}` });
  const notMounted = rows.filter((r) => !r.mounted).map((r) => r.screen);
  const overflowing = rows
    .filter((r) => r.overflowPx > 1)
    .map((r) => `${r.screen} (+${r.overflowPx}px)`);
  const erroring = rows.filter((r) => r.errors > 0).map((r) => r.screen);
  expect.soft(notMounted, `screens that did not mount at ${width}px`).toEqual([]);
  expect
    .soft(overflowing, `screens whose page scrolls sideways at ${width}px (horizontal overflow)`)
    .toEqual([]);
  expect.soft(erroring, `screens with uncaught errors at ${width}px`).toEqual([]);
}

async function sweep(page: Page, screens: readonly ScreenDef[]): Promise<Row[]> {
  const rows: Row[] = [];
  for (const [i, screen] of screens.entries()) {
    // eslint-disable-next-line playwright/no-wait-for-timeout -- request-rate pacing between screens (rate-limiter, 2026-10-07)
    if (i > 0) await page.waitForTimeout(4_000);
    rows.push(await measure(page, screen));
  }
  return rows;
}

test.describe('KPost responsive sweep — signed-in screens', { tag: '@ui' }, () => {
  test.describe.configure({ timeout: 600_000 });
  const personal = AUTHENTICATED_SCREENS.filter((s) => (s.session ?? 'personal') === 'personal');
  for (const vp of VIEWPORTS) {
    // eslint-disable-next-line playwright/expect-expect -- the assertions live in report()
    test(`every signed-in screen at ${vp.name} width (${vp.width}×${vp.height}) @ui`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await skipIfSignedOut(page);
      report(await sweep(page, personal), vp.name, vp.width);
    });
  }
});

test.describe('KPost responsive sweep — public screens', { tag: '@ui' }, () => {
  test.describe.configure({ timeout: 300_000 });
  test.use({ storageState: { cookies: [], origins: [] } });
  for (const vp of VIEWPORTS) {
    // eslint-disable-next-line playwright/expect-expect -- the assertions live in report()
    test(`every public screen at ${vp.name} width (${vp.width}×${vp.height}) @ui`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      report(await sweep(page, PUBLIC_SCREENS), vp.name, vp.width);
    });
  }
});
