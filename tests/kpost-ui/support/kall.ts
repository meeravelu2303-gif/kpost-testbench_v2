import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { parkPointerAwayFromSideMenu } from './katchup';

/**
 * Shared Kall steps: "Kool Kall" is a tab (not a button), and its `.create_font` control opens the
 * "Create Kool Kall" modal.
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
