import { TAGS } from '@config/constants';
import { ADMIN_SCREENS } from '@ui/admin-screens';
import { test } from '@fixtures';
import { expectAdminScreenLoads, requireAdminUiSession } from './support/admin-screen';

/**
 * FULL SANITY · Admin UI — every Admin / HR-Setup screen (`src/ui/admin-screens.ts`) mounts in the
 * SSO'd BUSINESS_M session, with its shell, and loads with no JS crash, no broken asset and no
 * server error. Read-only. The light counterpart of `admin-screens.spec.ts` (the deep sweep, which
 * adds every control and the full UI check catalogue).
 *
 * Admin joins the SANITY level through `@admin`; it runs in the runner's own Admin UI stage.
 */
test.describe(
  'SANITY · Admin UI · every screen loads',
  { tag: [TAGS.ui, TAGS.admin, TAGS.sanity, TAGS.sanitySweep] },
  () => {
    requireAdminUiSession();

    for (const screen of ADMIN_SCREENS) {
      test(`${screen.name} (${screen.route}) loads cleanly`, async ({ page }) => {
        await expectAdminScreenLoads(page, screen);
      });
    }
  },
);
