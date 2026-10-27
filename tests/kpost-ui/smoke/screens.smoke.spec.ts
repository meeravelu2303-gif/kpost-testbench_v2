import { TAGS } from '@config/constants';
import { test } from '@fixtures';
import { expectModuleScreensLoad, requirePersonalAccount, screensOf } from './smoke-ui';

/**
 * UI SMOKE · every module's screens load — one test per module, covering every screen in the screen
 * registry (`src/ui/screens.ts`) in the session it needs (personal, business admin, signed out).
 * A new screen joins the smoke the moment it is added to the registry; a paused one (KDoc) leaves it.
 */
const MODULES: ReadonlyArray<{ name: string; tag: string }> = [
  { name: 'Signup & Login', tag: TAGS.auth },
  { name: 'Home', tag: TAGS.home },
  { name: 'Katchup', tag: TAGS.katchup },
  { name: 'Kall', tag: TAGS.kall },
  { name: 'KMail', tag: TAGS.kmail },
  { name: 'Profile', tag: TAGS.profile },
  { name: 'Settings', tag: TAGS.settings },
  { name: 'User Management (business)', tag: TAGS.userManagement },
  { name: 'Verticals', tag: TAGS.verticals },
  { name: 'Platform pages', tag: TAGS.platform },
];

test.describe('SMOKE · UI · screens load', { tag: [TAGS.ui, TAGS.smoke, TAGS.regression] }, () => {
  requirePersonalAccount();

  for (const mod of MODULES) {
    const screens = screensOf(mod.tag);

    test(
      `${mod.name}: ${screens.map((s) => s.name).join(', ')} load cleanly`,
      { tag: [mod.tag, TAGS.sanity] },
      async ({ page, browser }) => {
        test.setTimeout(60_000 + screens.length * 45_000);
        await expectModuleScreensLoad(page, browser, screens);
      },
    );
  }
});
