import { test } from '@fixtures';
import { requireAdminUiSession } from '../support/admin-screen';
import { requireAdminUiWrites } from '../support/admin-workflow';
import {
  tierLifecycle,
  topVariableLifecycle,
  type TierScreen,
} from '../support/tier-variable-flows';

/**
 * Admin UI HR Breakdown Setup: a QA tier and a QA top-level variable are created, renamed and deleted
 * on screen. Host-guarded: nothing is written unless the screen calls the test Admin API.
 */
const SCREEN: TierScreen = {
  name: 'HR Breakdown Setup',
  route: '/hr-breakdown-setup',
  // The page heading wrongly reads "Work Place Setup"; the route tells them apart.
  title: /Work Place Setup|HR Breakdown/,
  tierApi: '/hrSetUpTierAttribute',
  variableApi: '/hrSetUpTierVariable',
};

test.describe(
  'Admin UI · HR Breakdown Setup — create, edit, delete on screen',
  { tag: '@admin-ui' },
  () => {
    test.describe.configure({ timeout: 180_000, mode: 'serial' });
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
