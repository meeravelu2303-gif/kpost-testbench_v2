import { TAGS } from '@config/constants';
import { ADMIN_SCREENS } from '@ui/admin-screens';
import { test } from '@fixtures';
import { expectAdminScreenLoads, requireAdminUiSession } from '../support/admin-screen';

/**
 * Admin UI sanity, read-only: every Admin screen mounts in the BUSINESS_M session with its shell and
 * no JS crash, broken asset or server error. The light counterpart of admin-screens.spec.ts.
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
