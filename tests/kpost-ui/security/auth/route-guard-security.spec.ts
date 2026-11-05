import { testData } from '@config/test-data.config';
import { AUTHENTICATED_SCREENS, BUSINESS_SCREENS } from '@ui/screens';
import { expect, test } from '@fixtures';

/**
 * Who may open which screen (MenuRoutes.js): every signed-in route sits under one guard
 * (`user.user ? <Header /> : <Navigate to="/login" />`), and User Management has no role guard of
 * its own; Header.js only hides its menu entry from personal users.
 *
 * 1. Signed out: every signed-in route sends the visitor to /login and renders none of the screen.
 *    KPoster is left out (signed out it is the public feed by design, MenuRoutes.js:412), and so is
 *    the 404 screen (any unknown path renders it).
 * 2. A personal user who types /usermanagement must not get the company admin's screen: no member
 *    list, no "Add New Channels".
 */
const SIGNED_IN_ROUTES = [...AUTHENTICATED_SCREENS, ...BUSINESS_SCREENS].filter(
  (s) => s.screen !== 'kposter' && s.screen !== 'not-found',
);

test.describe(
  'KPost UI · signed-in screens are closed to a signed-out visitor',
  {
    tag: ['@ui', '@auth', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    for (const screen of SIGNED_IN_ROUTES) {
      test(`${screen.route} (${screen.name}) sends a signed-out visitor to /login @ui`, async ({
        page,
      }) => {
        await page.goto(screen.route, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await expect(page, `${screen.route} redirects to the login screen`).toHaveURL(/\/login/, {
          timeout: 20_000,
        });
        for (const selector of screen.ready)
          await expect
            .soft(page.locator(selector), `${screen.name} does not render for a signed-out visitor`)
            .toHaveCount(0);
      });
    }
  },
);

test.describe(
  'KPost UI · a personal user cannot open the company admin screens',
  {
    tag: ['@ui', '@auth', '@user-management', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    for (const screen of BUSINESS_SCREENS) {
      test(`a personal user who types ${screen.route} does not get ${screen.name} @ui`, async ({
        page,
      }) => {
        await page.goto('/home', { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await expect(page, 'the personal session is signed in').not.toHaveURL(/\/login/, {
          timeout: 20_000,
        });
        await page.goto(screen.route, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        // Give the screen the time it takes to mount for its admin, then judge what it shows.
        await page
          .locator(screen.ready.join(', '))
          .first()
          .waitFor({ state: 'attached', timeout: 15_000 })
          .catch(() => undefined);
        const shown = (await page.locator('body').innerText()).slice(0, 300).replace(/\s+/g, ' ');
        for (const control of screen.controls)
          await expect
            .soft(
              page.locator(control.selector),
              `${control.label} is not offered to a personal user on ${screen.route} (page: ${shown})`,
            )
            .toHaveCount(0);
        for (const selector of screen.ready)
          await expect
            .soft(
              page.locator(selector),
              `${screen.name} does not render for a personal user (page: ${shown})`,
            )
            .toHaveCount(0);
      });
    }
  },
);
