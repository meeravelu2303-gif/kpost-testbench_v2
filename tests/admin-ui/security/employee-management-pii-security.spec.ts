import { env } from '@config/env';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Employee Management's Promote/Transfer/Suspend/Revoke/Terminate tabs must not show the picked
 * employee's PAN number in plain text (#1051). Each test skips when no employee is available to
 * pick. Needs ADMIN_UI_LIFECYCLE=true.
 */
test.describe(
  'Admin/HR-Setup Employee Management — PAN card exposure',
  { tag: '@admin-ui' },
  () => {
    test.skip(
      process.env.ADMIN_UI_LIFECYCLE !== 'true' ||
        !env.ADMIN_UI_BASE_URL ||
        testData.businessMKpostId.includes('qa.business'),
      'needs ADMIN_UI_LIFECYCLE=true, a configured admin host and BUSINESS_M account',
    );

    const TABS: Array<{
      tab: 'Promote' | 'Transfer' | 'Suspend' | 'Revoke' | 'Terminate';
      action: string;
    }> = [
      { tab: 'Promote', action: 'Promote Employee' },
      { tab: 'Transfer', action: 'Transfer Employee' },
      { tab: 'Suspend', action: 'Suspend Employee' },
      { tab: 'Revoke', action: 'Revoke Employee' },
      { tab: 'Terminate', action: 'Terminate Employee' },
    ];

    for (const { tab, action } of TABS) {
      test(`${tab}: the employee card must not show the PAN card number in plain text @ui`, async ({
        adminPage,
      }) => {
        await adminPage.goto();
        await adminPage.openTab(tab);
        await adminPage.openActionForm(action);

        const picked = await adminPage.selectFirstEmployee();
        test.skip(!picked, `no employee was available to pick on the ${tab} tab`);
        if (!picked) return;

        const pan = await adminPage.visiblePanCardText();

        expect(
          pan,
          `the ${tab} tab's employee card must not render the real PAN card number as plain text`,
        ).toBeNull();
      });
    }
  },
);
