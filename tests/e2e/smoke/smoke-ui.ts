import { STORAGE_STATE_BUSINESS, TAGS } from '@config/constants';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import type { Browser, Page } from '@playwright/test';
import {
  AUTHENTICATED_SCREENS,
  BUSINESS_SCREENS,
  PUBLIC_SCREENS,
  type ScreenDef,
} from '@ui/screens';
import { healthFailures, watchUiHealth } from '@ui/ui-health';

/**
 * Shared UI smoke steps. A smoke check never skips because the saved session is gone: the setup
 * project signed in moments before, so landing on `/login` is a failure the run must show.
 */

/** Which module each registry screen belongs to (every screen in `src/ui/screens.ts` is listed). */
const MODULE_OF_SCREEN: Readonly<Record<string, string>> = {
  home: TAGS.home,
  katchup: TAGS.katchup,
  kall: TAGS.kall,
  'kall-window': TAGS.kall,
  kmail: TAGS.kmail,
  writemail: TAGS.kmail,
  userprofile: TAGS.profile,
  settings: TAGS.settings,
  usermanagement: TAGS.userManagement,
  login: TAGS.auth,
  signup: TAGS.auth,
  kdiary: TAGS.verticals,
  kcloud: TAGS.verticals,
  kbooking: TAGS.verticals,
  knews: TAGS.verticals,
  'e-commerce': TAGS.verticals,
  kdirectory: TAGS.verticals,
  kposter: TAGS.verticals,
  'child-safety-policy': TAGS.platform,
  'not-found': TAGS.platform,
};

/** Every registry screen (paused ones already removed), with the module it belongs to. */
export function screensOf(moduleTag: string): readonly ScreenDef[] {
  return [...AUTHENTICATED_SCREENS, ...BUSINESS_SCREENS, ...PUBLIC_SCREENS].filter(
    (screen) => (MODULE_OF_SCREEN[screen.screen] ?? TAGS.platform) === moduleTag,
  );
}

/** Pause between screens in one test: the request-rate pacing of the screen sweeps (2026-10-07). */
const PACE_MS = 3_000;

/** The account the default `page` is signed in as must be a real QA account. */
export function requirePersonalAccount(): void {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real QA account (QA_KPOST_ID)',
  );
}

/**
 * Open `screen` in the session it needs and prove it loaded: not bounced to the login page, its own
 * mount selector visible, no JS crash, no broken asset, no server error on the calls it made.
 */
async function expectScreenLoads(page: Page, screen: ScreenDef): Promise<void> {
  const stop = watchUiHealth(page);
  await page.goto(screen.route, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  if (screen.session !== 'public') {
    await expect(
      page,
      `${screen.name}: still signed in (not sent to the login page)`,
    ).not.toHaveURL(/\/login(\b|$)/, { timeout: 5_000 });
  }
  await expect(page.locator(screen.ready.join(', ')).first(), `${screen.name} mounted`).toBeVisible(
    { timeout: 20_000 },
  );
  const report = stop();
  const failures = [
    ...healthFailures(report),
    ...report.failedApiCalls
      .filter((call) => call.status >= 500)
      .map((call) => `server error ${call.status}: ${call.method} ${call.url}`),
  ];
  expect(failures, `${screen.name} loaded without a crash or server error`).toEqual([]);
}

/** Load every screen of a module, each in its own session (one step per screen in the report). */
export async function expectModuleScreensLoad(
  page: Page,
  browser: Browser,
  screens: readonly ScreenDef[],
): Promise<void> {
  for (const [index, screen] of screens.entries()) {
    // Deliberate request-rate pacing, not a wait for a condition (see PACE_MS).
    // eslint-disable-next-line playwright/no-wait-for-timeout -- intentional pacing (rate-limiter)
    if (index > 0) await page.waitForTimeout(PACE_MS);

    await test.step(`${screen.name} (${screen.route})`, async () => {
      if (screen.session === 'public' || screen.session === 'business') {
        const context = await browser.newContext({
          storageState:
            screen.session === 'business' ? STORAGE_STATE_BUSINESS : { cookies: [], origins: [] },
        });
        try {
          await expectScreenLoads(await context.newPage(), screen);
        } finally {
          await context.close();
        }
      } else {
        await expectScreenLoads(page, screen);
      }
    });
  }
}
