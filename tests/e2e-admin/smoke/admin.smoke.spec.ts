import { TAGS } from '@config/constants';
import { ADMIN_SCREENS } from '@ui/admin-screens';
import { expect, test } from '@fixtures';
import { expectAdminScreenLoads, requireAdminUiSession } from '../support/admin-screen';

/**
 * ADMIN UI SMOKE — the Admin / HR-Setup front end is up: a signed-out visitor gets its login screen,
 * and every Admin screen (`src/ui/admin-screens.ts`) loads in the SSO'd BUSINESS_M session. Read-only.
 * Runs in the runner's own `SMOKE · Admin UI` stage, after the KPost smoke.
 */
test.describe('SMOKE · Admin UI', { tag: [TAGS.ui, TAGS.admin, TAGS.smoke, TAGS.sanity] }, () => {
  test.describe('signed out', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('the Admin login screen is served to a signed-out visitor', async ({ page }) => {
      await page.goto('/login', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await expect(
        page.getByPlaceholder('Enter KPOST ID / Mobile number'),
        'the login-id field is visible',
      ).toBeVisible({ timeout: 20_000 });
    });
  });

  test.describe('signed in (company admin)', () => {
    requireAdminUiSession();

    test(`${ADMIN_SCREENS.map((s) => s.name).join(', ')} load cleanly`, async ({ page }) => {
      test.setTimeout(60_000 + ADMIN_SCREENS.length * 45_000);
      for (const screen of ADMIN_SCREENS) {
        await test.step(`${screen.name} (${screen.route})`, () =>
          expectAdminScreenLoads(page, screen));
      }
    });
  });
});
