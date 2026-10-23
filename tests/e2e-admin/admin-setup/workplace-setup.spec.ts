import { test } from '@fixtures';
import { requireAdminUiSession } from '../support/admin-screen';
import { requireAdminUiWrites } from '../support/admin-workflow';
import {
  tierLifecycle,
  topVariableLifecycle,
  type TierScreen,
} from '../support/tier-variable-flows';

/**
 * Admin UI · **Work Place Setup** (/workplace-setup), done on screen: a QA tier and a QA top-level variable are each
 * created in the drawer, renamed and deleted, with the request and answer of every step checked and
 * an API clean-up if a step fails. Host-guarded: nothing is written unless the screen's Admin calls go
 * to the test Admin API (support/admin-workflow.ts).
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
