import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { parkPointerAwayFromSideMenu } from './katchup';

/**
 * Shared Kall steps, read from the front-end source (2026-10-11):
 *   - `/kall` is a react-bootstrap `Tabs` page (`Kall/components/KallPage/KallPage.js`): the
 *     scheduled-call tab is the TAB "Kool Kall" (role=tab, not a button);
 *   - the Kool Kall panel's "Create" control is `.create_font` (`KoolContainer.js`,
 *     `setCreateKallModal(true)`) and opens `CreateKallModal` — a `ModalComponent` titled
 *     "Create Kool Kall" whose first field is `input[placeholder="Enter Meeting Title"]`.
 *
 * Until 2026-10-11 the Kall specs clicked `getByRole('button', { name: /Kool Kall/ })` (there is no
 * such button) and then force-clicked Create under the side menu, so the modal never opened and
 * every site skipped as "did not open on this build".
 */
export async function gotoKoolKall(page: Page): Promise<void> {
  await page.goto('/kall', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page
    .locator('.loader-overlay')
    .waitFor({ state: 'hidden', timeout: 30_000 })
    .catch(() => undefined);
  await parkPointerAwayFromSideMenu(page);
  await page
    .getByRole('tab', { name: /Kool Kall/i })
    .first()
    .click({ timeout: 15_000 });
}

/** From the Kool Kall tab: Create → the Create Kool Kall modal; returns the modal (or null). */
export async function openCreateKall(page: Page): Promise<Locator | null> {
  const create = page.locator('.create_font').first();
  await expect(create, 'the Create control is present on the Kool Kall tab').toBeVisible({
    timeout: 20_000,
  });
  await create.click();
  const modal = page
    .getByRole('dialog')
    .filter({ hasText: /Create Kool Kall/i })
    .first();
  const opened = await modal.isVisible({ timeout: 15_000 }).catch(() => false);
  return opened ? modal : null;
}

/** The modal's meeting-title field. */
export function meetingTitleField(modal: Locator): Locator {
  return modal.locator('input[placeholder="Enter Meeting Title"]').first();
}
