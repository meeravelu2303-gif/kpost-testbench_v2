/* eslint-disable playwright/no-conditional-in-test */
import { env } from '@config/env';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Employee Management's 5 live sub-tabs (Promote/Transfer/Suspend/Revoke/Terminate — History is a
 * confirmed dead stub, see `admin-employee-management-dead-screens.spec.ts`) each render an
 * identical "employee card" panel once an employee is picked, and every one of them shows the
 * employee's PAN card number as plain, unmasked text (confirmed from source 2026-10-05: `Suspend.js`
 * ~line 423, `<div>{selectedEmployee.panCard}</div>`, repeated with the same shape in
 * Promote/Transfer/Revoke/Terminate).
 *
 * Gated behind `ADMIN_UI_LIFECYCLE=true`, same gate as `admin-screens.spec.ts` — a normal run never
 * touches the admin host.
 *
 * Confirmed live 2026-10-05: BUSINESS_M (the bench's test company) currently has ZERO role
 * postings, so every one of these tabs' employee picker shows "No options" and every test below
 * self-skips via `selectFirstEmployee()` returning false — not a selector problem (role=combobox /
 * role=option were confirmed working against the real dropdown). Filed source-only as bug #1051
 * until a bench-owned company has a real role posting to pick from; this file will produce live,
 * screenshotted proof automatically the moment one exists.
 */
test.describe('Admin/HR-Setup Employee Management — PAN card exposure', { tag: '@admin-ui' }, () => {
  test.skip(
    process.env.ADMIN_UI_LIFECYCLE !== 'true' ||
      !env.ADMIN_UI_BASE_URL ||
      testData.businessMKpostId.includes('qa.business'),
    'needs ADMIN_UI_LIFECYCLE=true, a configured admin host and BUSINESS_M account',
  );

  const TABS: Array<{ tab: 'Promote' | 'Transfer' | 'Suspend' | 'Revoke' | 'Terminate'; action: string }> = [
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
});
