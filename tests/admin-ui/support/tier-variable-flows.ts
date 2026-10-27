import type { Page } from '@playwright/test';
import { expect, test } from '@fixtures';
import {
  adminApiAsPage,
  confirmDelete,
  drawer,
  expectNoLiveWrites,
  guardAdminHosts,
  nextAdminCall,
  openAdd,
  openAdminScreen,
  openList,
  openTab,
  qaName,
  requireTestAdminApi,
  rowAction,
  savedId,
  stage,
  tableRow,
} from './admin-workflow';

/**
 * Tier and Variable flows shared by Work Place Setup and HR Breakdown Setup (same components, different
 * endpoints): create, edit and delete a QA record on screen. If a step fails, `finally` deletes it
 * through the API. No external side effects.
 */
export interface TierScreen {
  /** e.g. 'Work Place Setup'. */
  name: string;
  route: string;
  /** The `.title-font` text (HR Breakdown's page wrongly reads "Work Place Setup" too). */
  title: RegExp;
  /** '/adminTierAttribute' or '/hrSetUpTierAttribute'. */
  tierApi: string;
  /** '/adminTierVariable' or '/hrSetUpTierVariable'. */
  variableApi: string;
}

const ok = (r: { status: number; body: { status?: string } }): boolean =>
  r.status === 200 && r.body.status === 'SUCCESS';

/** Open the screen behind the host guard, prove it talks to the TEST Admin API, open the tab's list. */
async function openGuarded(page: Page, screen: TierScreen, tab: 'Tier' | 'Variable') {
  const guard = await guardAdminHosts(page);
  await openAdminScreen(page, screen.route, screen.title);
  await openTab(page, tab);
  await openList(page);
  await expect
    .poll(() => guard.adminHosts.size, { message: 'the screen loaded its data', timeout: 20_000 })
    .toBeGreaterThan(0);
  requireTestAdminApi(guard);
  return guard;
}

export async function tierLifecycle(page: Page, screen: TierScreen): Promise<void> {
  const guard = await openGuarded(page, screen, 'Tier');
  const name = qaName('tier');
  const renamed = `${name} edited`;
  let current = name; // what the record is called now (stays `name` if the rename failed)
  let id: string | undefined;
  let deleted = false;
  try {
    await stage(
      'create a tier in the drawer',
      async () => {
        await openAdd(page);
        await expect(drawer(page), 'the "Create Tiers" drawer opens').toContainText('Create Tiers');
        await drawer(page).getByPlaceholder('Enter Name of the Tier').fill(name);
        const saved = await nextAdminCall(page, `${screen.tierApi}/save`, () =>
          drawer(page).locator('button.savebutton').click(),
        );
        expect(
          ok(saved),
          `${screen.tierApi}/save answers 200 SUCCESS: ${JSON.stringify(saved.body).slice(0, 200)}`,
        ).toBe(true);
        id = savedId(saved.body.value);
        expect(id, 'the save returns the new tier id').toBeTruthy();
      },
      { blocker: true },
    );

    await stage('the new tier is listed', async () => {
      await openList(page);
      await tableRow(page, name);
    });

    await stage('rename it', async () => {
      await openList(page);
      await rowAction(page, await tableRow(page, current), 'Edit');
      await expect(drawer(page), 'the "Update Tier" drawer opens').toContainText('Update Tier');
      const input = drawer(page).getByPlaceholder('Enter Name of the Tier');
      await expect(input, 'prefilled with the current name').toHaveValue(current);
      await input.fill(renamed);
      const updated = await nextAdminCall(page, `${screen.tierApi}/update`, () =>
        drawer(page).getByRole('button', { name: 'Update' }).click(),
      );
      expect(ok(updated), `${screen.tierApi}/update answers 200 SUCCESS`).toBe(true);
      current = renamed;
      await tableRow(page, renamed);
    });

    await stage('delete it', async () => {
      await openList(page);
      await rowAction(page, await tableRow(page, current), 'Delete');
      const removed = await nextAdminCall(page, `${screen.tierApi}/delete`, () =>
        confirmDelete(page),
      );
      expect(ok(removed), `${screen.tierApi}/delete answers 200 SUCCESS`).toBe(true);
      deleted = true;
      await expect(
        page.locator('tr').filter({ hasText: current }),
        'the tier is gone from the list',
      ).toHaveCount(0, {
        timeout: 15_000,
      });
    });

    expectNoLiveWrites(guard);
  } finally {
    if (id && !deleted)
      await adminApiAsPage(page, `${screen.tierApi}/delete`, { id }).catch(() => undefined);
  }
}

export async function topVariableLifecycle(page: Page, screen: TierScreen): Promise<void> {
  const guard = await openGuarded(page, screen, 'Variable');
  const noTiers = page.locator('.Toastify__toast').filter({ hasText: 'No Tiers Found' });
  test.skip(
    await noTiers.isVisible().catch(() => false),
    `${screen.name}: the QA company has no tiers to add a variable under`,
  );
  const name = qaName('variable');
  const renamed = `${name} edited`;
  let current = name; // what the record is called now (stays `name` if the rename failed)
  let id: string | undefined;
  let deleted = false;
  try {
    await stage(
      'create a variable under the top tier',
      async () => {
        // The top tier's "Add" is always enabled; lower tiers need their parent chosen first.
        await page.locator('button.addbutton.cursor-pointer').first().click();
        await expect(drawer(page), 'the "Create <tier>" drawer opens').toContainText('Create');
        await drawer(page)
          .getByPlaceholder(/^Enter Name of the /)
          .fill(name);
        const saved = await nextAdminCall(page, `${screen.variableApi}/save`, () =>
          drawer(page).locator('button.savebutton').click(),
        );
        expect(
          ok(saved),
          `${screen.variableApi}/save answers 200 SUCCESS: ${JSON.stringify(saved.body).slice(0, 200)}`,
        ).toBe(true);
        id = savedId(saved.body.value);
        expect(id, 'the save returns the new variable id').toBeTruthy();
      },
      { blocker: true },
    );

    await stage('the screen confirms the save and lists the variable', async () => {
      await expect(
        page.locator('.Toastify__toast').filter({ hasText: 'Variable saved successfully' }),
        'the screen confirms the save',
      ).toBeVisible({ timeout: 10_000 });
      await openList(page);
      await tableRow(page, name);
    });

    await stage('rename it', async () => {
      await openList(page);
      await rowAction(page, await tableRow(page, current), 'Edit');
      await expect(drawer(page), 'the "Update <tier>" drawer opens').toContainText('Update');
      const input = drawer(page).getByPlaceholder(/^Enter Name of the /);
      await expect(input, 'prefilled with the current name').toHaveValue(current);
      await input.fill(renamed);
      const updated = await nextAdminCall(page, `${screen.variableApi}/update`, () =>
        drawer(page).getByRole('button', { name: 'Update' }).click(),
      );
      expect(ok(updated), `${screen.variableApi}/update answers 200 SUCCESS`).toBe(true);
      current = renamed;
      await expect(
        page.locator('.Toastify__toast').filter({ hasText: 'Variable Updated Successfully' }),
      ).toBeVisible({ timeout: 10_000 });
      await tableRow(page, renamed);
    });

    await stage('delete it', async () => {
      await openList(page);
      await rowAction(page, await tableRow(page, current), 'Delete');
      const removed = await nextAdminCall(page, `${screen.variableApi}/delete`, () =>
        confirmDelete(page),
      );
      expect(ok(removed), `${screen.variableApi}/delete answers 200 SUCCESS`).toBe(true);
      deleted = true;
      await expect(
        page.locator('.Toastify__toast').filter({ hasText: 'Variable Deleted Successfully' }),
      ).toBeVisible({ timeout: 10_000 });
    });

    expectNoLiveWrites(guard);
  } finally {
    if (id && !deleted)
      await adminApiAsPage(page, `${screen.variableApi}/delete`, { id }).catch(() => undefined);
  }
}
