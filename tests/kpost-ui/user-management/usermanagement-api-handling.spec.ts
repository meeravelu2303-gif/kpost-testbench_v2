import { STORAGE_STATE_BUSINESS } from '@config/constants';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { openUserManagement } from '../support/usermanagement';
import { toast } from '../support/validation';

/**
 * BUSINESS_S User Management: a backup-admin change that gets no answer is reported. The call is
 * aborted in the browser (UserManagement.js AddBackupAdmin: the service returns nothing, so the
 * screen's catch runs), so no member's role changes on the shared business account.
 */
test.describe(
  'KPost company-admin · User Management reports a backup-admin change that gets no answer',
  {
    tag: ['@ui', '@user-management', '@regression'],
    annotation: [{ type: 'non-functional', description: 'resilience' }],
  },
  () => {
    test.use({ storageState: STORAGE_STATE_BUSINESS });
    test.skip(
      process.env.BUSINESS_UI_LIFECYCLE !== 'true',
      'needs the BUSINESS_S admin session; set BUSINESS_UI_LIFECYCLE=true',
    );
    test.skip(
      !testData.businessSKpostId || testData.businessSKpostId.includes('qa.business'),
      'needs the BUSINESS_S account (QA_BUSINESS_S_KPOST_ID)',
    );

    test('a backup-admin change that gets no answer says "some error occured !"', async ({
      page,
    }) => {
      let aborted = 0;
      await page.route('**/admin/createOrRemoveBackupAdmin/**', (route) => {
        aborted += 1;
        return route.abort();
      });
      await openUserManagement(page);
      // An active member (the inactive rows are "not-allowed") opens that member's Digital Card.
      const members = page.locator('.border-bottom .default-cursor');
      const listed = await members
        .first()
        .waitFor({ state: 'visible', timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      test.skip(!listed, 'needs provisioned active member in the BUSINESS_S company');
      // The card offers the action only for another, non-admin member: try the first few rows.
      const action = page
        .getByRole('button', { name: /^(Make|Remove) Backup Admin$/ })
        .filter({ visible: true })
        .first();
      let offered = false;
      const count = Math.min(await members.count(), 6);
      for (let i = 0; i < count && !offered; i += 1) {
        await members.nth(i).click();
        offered = await action
          .waitFor({ state: 'visible', timeout: 5_000 })
          .then(() => true)
          .catch(() => false);
        if (!offered) await page.keyboard.press('Escape');
      }
      test.skip(!offered, 'needs provisioned member the admin can make backup admin');
      await action.click();
      await page.getByRole('button', { name: /^Ok$/ }).filter({ visible: true }).last().click();

      await expect(toast(page, 'some error occured !'), 'the user is told').toBeVisible({
        timeout: 10_000,
      });
      expect(aborted, 'the change was stopped in the browser').toBe(1);
    });
  },
);
