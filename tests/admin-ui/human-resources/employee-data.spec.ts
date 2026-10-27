import { testData } from '@config/test-data.config';
import type { Page } from '@playwright/test';
import { expect, test } from '@fixtures';
import { requireAdminUiSession } from '../support/admin-screen';
import {
  adminApiAsPage,
  confirmDelete,
  expectNoLiveWrites,
  guardAdminHosts,
  nextAdminCall,
  openAdd,
  openAdminScreen,
  openList,
  pickByPlaceholder,
  requireAdminUiWrites,
  requireTestAdminApi,
  rowAction,
  savedId,
  stage,
  tableRow,
} from '../support/admin-workflow';

/**
 * Admin UI Employee Data: a fake QA employee is entered through the six-step form, listed, edited and
 * deleted on screen. The record is a MongoDB row only (no login, invite, mail or SMS). Host-guarded.
 */
const ok = (r: { status: number; body: { status?: string } }): boolean =>
  r.status === 200 && r.body.status === 'SUCCESS';

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

async function next(page: Page): Promise<void> {
  await page.locator('button.nextbutton').first().click();
}

async function employeeLifecycle(page: Page): Promise<void> {
  const guard = await guardAdminHosts(page);
  await openAdminScreen(page, '/employee-data', /Employee Data/);
  await openList(page);
  await expect
    .poll(() => guard.adminHosts.size, { message: 'the screen loaded its data', timeout: 20_000 })
    .toBeGreaterThan(0);
  requireTestAdminApi(guard);

  const stamp = Date.now() % 1_000_000;
  const first = `Qaemp${stamp}`;
  const last = 'Bench';
  const edited = 'Benchedit';
  let id: string | undefined;
  let deleted = false;
  try {
    await stage(
      'enter a new employee through the six steps and submit',
      async () => {
        await openAdd(page);
        await page.getByText('Add Employee Data', { exact: true }).first().click();

        // Step 1 — personal information.
        await page.locator('#firstName').fill(first);
        await page.locator('#lastName').fill(last);
        await page.locator('#dob').fill('1990-01-15');
        await pickByPlaceholder(page, 'Select Gender', 'Male');
        await pickByPlaceholder(page, 'Select Marital Status');
        await page.locator('#mobile').fill(`6${String(stamp).padStart(9, '0')}`);
        await page.locator('#emailaddress').fill(`qa.employee.${stamp}@example.com`);
        await pickByPlaceholder(page, 'Select Nationality', 'India');
        await page.locator('input[name="showDropdown"][value="no"]').check();
        await next(page);

        // Step 2 — employment.
        await pickByPlaceholder(page, 'Select Employment Status');
        await page.locator('#dateOfJoining').fill(isoDate(new Date()));
        await next(page);

        // Step 3 — address (residential; mailing copied).
        await pickByPlaceholder(page, 'Select Country', 'India');
        await page.getByPlaceholder('Enter Zip Code').first().fill(testData.pinCode);
        await pickByPlaceholder(page, 'Select Area');
        await page.getByPlaceholder('Enter Address Line 1').first().fill('QA bench street');
        await page.getByPlaceholder('Enter Address Line 2').first().fill('QA bench area');
        await page.getByText('Click if Same as Residential Address').first().click();
        await next(page);

        // Step 4 — education.
        await pickByPlaceholder(page, 'Select qualification');
        const institute = page.getByPlaceholder('Enter Institute Name').first();
        if (await institute.isVisible().catch(() => false)) await institute.fill('QA Institute');
        else {
          const creatable = page
            .locator('[class*="placeholder"]', { hasText: 'Enter Institute Name' })
            .locator('xpath=following::input[1]');
          await creatable.fill('QA Institute');
          await creatable.press('Enter');
        }
        await page.getByPlaceholder('Enter your Percentage').first().fill('75');
        await page.locator('#yearofgraduation-0').fill('2012-05-31');
        await next(page);

        // Step 5 — work experience: "No" lets the step pass.
        await pickByPlaceholder(page, 'Select Work Experience', 'No');
        await next(page);

        // Step 6 — additional, then Submit → the "Confimation" modal → Submit.
        // Step 6 has its own required Nationality; step 1's choice does not carry over.
        await pickByPlaceholder(page, 'Select Nationality', 'India');
        await pickByPlaceholder(page, 'Select Citizenship');
        await page.getByPlaceholder('Enter PAN Number').fill('ABCPE1234F');
        await page.getByPlaceholder('Enter Aadhar Card Number').fill('234123412346');
        await page.locator('button.addbutton').filter({ hasText: 'Submit' }).first().click();
        const modal = page.locator('.modal').filter({ hasText: 'Are you sure you want to submit' });
        const saved = await nextAdminCall(page, '/employeeDetails/save', () =>
          modal.locator('button.savebutton').click(),
        );
        expect(
          ok(saved),
          `/employeeDetails/save answers 200 SUCCESS: ${JSON.stringify(saved.body).slice(0, 200)}`,
        ).toBe(true);
        id = savedId(saved.body.value);
        expect(id, 'the save returns the new employee id').toBeTruthy();
      },
      { blocker: true },
    );

    await stage('the screen confirms the save', async () => {
      await expect(
        page.locator('.Toastify__toast').first(),
        'the screen confirms the save',
      ).toContainText(/fully Save/i, { timeout: 10_000 });
    });

    await stage('the employee is listed, and an edit of the last name is saved', async () => {
      await openList(page);
      await rowAction(page, await tableRow(page, first), 'Edit');
      await expect(page.locator('#firstName'), 'the form reopens with the employee').toHaveValue(
        first,
        { timeout: 15_000 },
      );
      await page.locator('#lastName').fill(edited);
      // Edit mode has no validation; step to the end, where "Update" replaces Submit.
      const update = page.getByRole('button', { name: 'Update' }).first();
      for (let i = 0; i < 6 && !(await update.isVisible().catch(() => false)); i++)
        await next(page);
      const sent = page.waitForRequest(
        (r) => r.url().includes('/employeeDetails/update') && r.method() === 'POST',
      );
      const updated = await nextAdminCall(page, '/employeeDetails/update', () => update.click());
      // The edit must send back the untouched saved fields (#13250).
      const body = JSON.parse((await sent).postData() ?? '{}') as {
        educationObj?: Array<{ instituteName?: unknown }>;
        mailingObj?: { mailingCountry?: unknown };
      };
      expect
        .soft(body.educationObj?.[0]?.instituteName, 'the edit keeps the saved institute name')
        .toBe('QA Institute');
      expect
        .soft(body.mailingObj?.mailingCountry, 'the edit keeps the saved mailing country')
        .toBe('India');
      expect(
        ok(updated),
        `/employeeDetails/update answers 200 SUCCESS: ${JSON.stringify(updated.body).slice(0, 200)}`,
      ).toBe(true);
      await openList(page);
      await expect(await tableRow(page, first), 'the list shows the new last name').toContainText(
        edited,
      );
    });

    await stage('delete it', async () => {
      // A failed edit can leave the form open: reload the screen so the list is reachable.
      if (!(await page.locator('tr').filter({ hasText: first }).count())) {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await openList(page);
      }
      await rowAction(page, await tableRow(page, first), 'Delete');
      const removed = await nextAdminCall(page, '/employeeDetails/delete', () =>
        confirmDelete(page),
      );
      expect(ok(removed), '/employeeDetails/delete answers 200 SUCCESS').toBe(true);
      deleted = true;
      await expect(
        page.locator('.Toastify__toast').filter({ hasText: /Employee Deleted/i }),
      ).toBeVisible({ timeout: 10_000 });
    });

    expectNoLiveWrites(guard);
  } finally {
    if (id && !deleted)
      await adminApiAsPage(page, '/employeeDetails/delete', { id }).catch(() => undefined);
  }
}

test.describe(
  'Admin UI · Employee Data — create, edit, delete on screen',
  { tag: '@admin-ui' },
  () => {
    test.describe.configure({ timeout: 240_000 });
    requireAdminUiSession();
    requireAdminUiWrites();

    test('an employee is entered, edited and deleted on screen @ui', async ({ page }) => {
      await employeeLifecycle(page);
    });
  },
);
