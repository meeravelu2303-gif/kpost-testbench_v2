import { test } from '@fixtures';
import { requireAdminUiSession } from '../support/admin-screen';
import { requireAdminUiWrites } from '../support/admin-workflow';
import {
  tierLifecycle,
  topVariableLifecycle,
  type TierScreen,
} from '../support/tier-variable-flows';

/**
 * Admin UI Work Place Setup: a QA tier and a QA top-level variable are created, renamed and deleted
 * on screen. Host-guarded: nothing is written unless the screen calls the test Admin API.
 */
const SCREEN: TierScreen = {
  name: 'Work Place Setup',
  route: '/workplace-setup',
  title: /Work Place Setup/,
  tierApi: '/adminTierAttribute',
  variableApi: '/adminTierVariable',
};

test.describe(
  'Admin UI · Work Place Setup — create, edit, delete on screen',
  { tag: '@admin-ui' },
  () => {
    // In order (each test makes its own data); a failed test never skips the next.
    test.describe.configure({ timeout: 180_000, mode: 'default' });
    requireAdminUiSession();
    requireAdminUiWrites();

    test('a tier is created, renamed and deleted on screen @ui', async ({ page }) => {
      await tierLifecycle(page, SCREEN);
    });

    test('a top-level variable is created, renamed and deleted on screen @ui', async ({ page }) => {
      await topVariableLifecycle(page, SCREEN);
    });
  },
);
