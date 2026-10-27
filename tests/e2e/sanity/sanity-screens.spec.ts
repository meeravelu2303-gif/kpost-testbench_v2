import { STORAGE_STATE_BUSINESS, TAGS } from '@config/constants';
import { testData } from '@config/test-data.config';
import {
  AUTHENTICATED_SCREENS,
  BUSINESS_SCREENS,
  PUBLIC_SCREENS,
  type ScreenDef,
} from '@ui/screens';
import { healthFailures, watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';
import { skipIfSignedOut } from '../support/session';

/**
 * Sanity: every registry screen (src/ui/screens.ts, minus PAUSED_SCREENS) mounts in its session with
 * no JS crash, broken asset or server error. The light counterpart of the deep screen sweep.
 */

/** Pause between screens: the same request-rate pacing as the deep sweep. */
const PACE_MS = 4_000;

/** Which module a screen belongs to, so `--module <name>` sanity picks it up. */
const MODULE_BY_SCREEN: Record<string, string> = {
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
};
const moduleOf = (screen: ScreenDef): string => MODULE_BY_SCREEN[screen.screen] ?? TAGS.platform;

/** A server error on a call the screen itself made. A 4xx is a screen's business, not a load fault. */
function loadFailures(stop: ReturnType<typeof watchUiHealth>): string[] {
  const report = stop();
  return [
    ...healthFailures(report),
    ...report.failedApiCalls
      .filter((call) => call.status >= 500)
      .map((call) => `server error ${call.status}: ${call.method} ${call.url}`),
  ];
}

function screensLoad(screens: readonly ScreenDef[], signedIn: boolean): void {
  if (signedIn) {
    test.beforeEach(async ({ page }) => {
      await skipIfSignedOut(page);
    });
  }

  for (const [index, screen] of screens.entries()) {
    test(
      `${screen.name} (${screen.route}) loads cleanly`,
      { tag: [moduleOf(screen)] },
      async ({ page }) => {
        // Deliberate request-rate pacing, not a wait for a condition (see PACE_MS).
        // eslint-disable-next-line playwright/no-wait-for-timeout -- intentional pacing (rate-limiter, 2026-10-07)
        if (index > 0) await page.waitForTimeout(PACE_MS);

        const stop = watchUiHealth(page);
        await page.goto(screen.route, { waitUntil: 'domcontentloaded', timeout: 45_000 });

        await expect(
          page.locator(screen.ready.join(', ')).first(),
          `${screen.name} mounted`,
        ).toBeVisible({ timeout: 20_000 });
        expect(loadFailures(stop), `${screen.name} loaded without a crash or server error`).toEqual(
          [],
        );
      },
    );
  }
}

test.describe(
  'SANITY · UI · every screen loads',
  { tag: [TAGS.ui, TAGS.sanity, TAGS.sanitySweep] },
  () => {
    test.describe('signed in (personal)', () => {
      test.skip(
        !testData.kpostId || testData.kpostId.includes('qa.bench'),
        'needs a real live account (QA_KPOST_ID)',
      );
      screensLoad(AUTHENTICATED_SCREENS, true);
    });

    test.describe('signed in (business admin)', () => {
      test.use({ storageState: STORAGE_STATE_BUSINESS });
      test.skip(
        process.env.BUSINESS_UI_LIFECYCLE !== 'true' ||
          !testData.businessSKpostId ||
          testData.businessSKpostId.includes('qa.business'),
        'needs the BUSINESS_S session (BUSINESS_UI_LIFECYCLE=true, QA_BUSINESS_S_KPOST_ID)',
      );
      screensLoad(BUSINESS_SCREENS, true);
    });

    test.describe('signed out (public)', () => {
      test.use({ storageState: { cookies: [], origins: [] } });
      screensLoad(PUBLIC_SCREENS, false);
    });
  },
);
