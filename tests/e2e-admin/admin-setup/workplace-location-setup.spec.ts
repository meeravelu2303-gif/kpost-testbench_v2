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
  pickDropdown,
  qaName,
  requireAdminUiWrites,
  requireTestAdminApi,
  rowAction,
  savedId,
  stage,
  tableRow,
} from '../support/admin-workflow';

/**
 * Admin UI · **Work Place Location Setup** (/workplace-location-setup), done on screen: a QA location is
 * added under the company's existing workplace tiers, renamed and deleted. Read from
 * `AdminSetup/MediumLarge/WorkPlaceLocationSetup/WorkPlaceLocationSetup.js` (2026-10-22): one dropdown per
 * workplace tier (label = tier name, placeholder "Select "), cascading; then name, country, a 6-digit
 * pincode that fills state and city, area, address. Save/Update need all of those (:1232-1240).
 * `/location/save|update|delete` only; delete is refused while a role posting uses the location (none
 * does: it is new). Host-guarded like every Admin write test.
 */
const ok = (r: { status: number; body: { status?: string } }): boolean =>
  r.status === 200 && r.body.status === 'SUCCESS';

/** Pick the first option in every still-empty tier dropdown, top tier first (each choice loads the next). */
async function pickWorkplaceTiers(page: Page): Promise<number> {
  let picked = 0;
  for (let i = 0; i < 8; i++) {
    const empty = page
      .locator('div.label-font')
      .filter({ has: page.locator('[class*="placeholder"]', { hasText: /^\s*Select\s*$/ }) })
      .first();
    if (!(await empty.isVisible().catch(() => false))) break;
    const input = empty.locator('input').first();
    await input.focus();
    await input.press('ArrowDown');
    const option = page.getByRole('option').first();
    await expect(option, 'the tier dropdown offers a value').toBeVisible({ timeout: 15_000 });
    await option.click();
    picked++;
  }
  return picked;
}

async function locationLifecycle(page: Page): Promise<void> {
  const guard = await guardAdminHosts(page);
  await openAdminScreen(page, '/workplace-location-setup', /Workplace Location Setup/i);
  await openList(page);
  await expect
    .poll(() => guard.adminHosts.size, { message: 'the screen loaded its data', timeout: 20_000 })
    .toBeGreaterThan(0);
  requireTestAdminApi(guard);

  const name = qaName('location');
  const renamed = `${name} edited`;
  let current = name; // what the record is called now (stays `name` if the rename failed)
  let id: string | undefined;
  let deleted = false;
  try {
    await stage(
      'add a location under the existing workplace tiers',
      async () => {
        await openAdd(page);
        await expect(page.getByText('Add Workplace Location').first()).toBeVisible({
          timeout: 15_000,
        });
        const tiers = await pickWorkplaceTiers(page);
        test.skip(
          tiers === 0,
          'the QA company has no workplace tier values on this account to place a location under',
        );
        await page.getByPlaceholder('Enter Name of the WorkPlace Location').fill(name);
        await pickDropdown(page, 'Country', 'India');
        await page.getByPlaceholder('Enter Pincode').fill(testData.pinCode);
        await expect(
          page.getByPlaceholder('Enter State'),
          'the pincode lookup fills the state',
        ).not.toHaveValue('', { timeout: 20_000 });
        await pickDropdown(page, 'Area');
        await page.getByPlaceholder('Address 1').fill('QA bench street');
        const saved = await nextAdminCall(page, '/location/save', () =>
          page.locator('button.savebutton').first().click(),
        );
        expect(
          ok(saved),
          `/location/save answers 200 SUCCESS: ${JSON.stringify(saved.body).slice(0, 200)}`,
        ).toBe(true);
        id = savedId(saved.body.value);
        expect(id, 'the save returns the new location id').toBeTruthy();
      },
      { blocker: true },
    );

    await stage('the screen confirms the save and lists the location', async () => {
      await expect(
        page.locator('.Toastify__toast').filter({ hasText: 'Locations created successfully' }),
        'the screen confirms the save',
      ).toBeVisible({ timeout: 10_000 });
      await openList(page);
      await tableRow(page, name);
    });

    await stage('rename it', async () => {
      await openList(page);
      await rowAction(page, await tableRow(page, current), 'Edit');
      const input = page.getByPlaceholder('Enter Name of the WorkPlace Location');
      await expect(input, 'the form reopens with the location').toHaveValue(current, {
        timeout: 15_000,
      });
      await input.fill(renamed);
      const updated = await nextAdminCall(page, '/location/update', () =>
        page.getByRole('button', { name: 'Update' }).first().click(),
      );
      expect(
        ok(updated),
        `/location/update answers 200 SUCCESS: ${JSON.stringify(updated.body).slice(0, 200)}`,
      ).toBe(true);
      current = renamed;
      await expect(
        page.locator('.Toastify__toast').filter({ hasText: 'Updated Successfully' }),
      ).toBeVisible({ timeout: 10_000 });
    });

    await stage('delete it', async () => {
      // A failed edit can leave the form open: reload the screen so the list is reachable.
      if (!(await page.locator('tr').filter({ hasText: current }).count())) {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await openList(page);
      }
      await rowAction(page, await tableRow(page, current), 'Delete');
      const removed = await nextAdminCall(page, '/location/delete', () => confirmDelete(page));
      expect(ok(removed), '/location/delete answers 200 SUCCESS').toBe(true);
      deleted = true;
      await expect(
        page
          .locator('.Toastify__toast')
          .filter({ hasText: 'location has been deleted successfully' }),
      ).toBeVisible({ timeout: 10_000 });
    });

    expectNoLiveWrites(guard);
  } finally {
    if (id && !deleted)
      await adminApiAsPage(page, '/location/delete', { id }).catch(() => undefined);
  }
}

test.describe(
  'Admin UI · Work Place Location Setup — create, edit, delete on screen',
  { tag: '@admin-ui' },
  () => {
    test.describe.configure({ timeout: 180_000 });
    requireAdminUiSession();
    requireAdminUiWrites();

    test('a workplace location is added, renamed and deleted on screen @ui', async ({ page }) => {
      await locationLifecycle(page);
    });
  },
);
