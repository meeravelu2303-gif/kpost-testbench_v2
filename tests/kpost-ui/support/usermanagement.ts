import { expect } from '@fixtures';
import type { Locator, Page } from '@playwright/test';

/**
 * Navigation for the BUSINESS_S User Management screen (`/usermanagement`) and its "Add Manually"
 * member form. Every helper stops short of ADD: completing the form provisions a real member account.
 */

/** Tolerates both wordings seen on the field, but never matches "Enter Second Mobile No". */
export const MOBILE_FIELD = /^Enter (10-digit )?Mobile No/i;

export async function openUserManagement(page: Page): Promise<void> {
  await page.goto('/usermanagement', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page
    .locator('.loader-overlay')
    .waitFor({ state: 'hidden', timeout: 30_000 })
    .catch(() => undefined);
  await expect(
    page.getByText(/Business User Management/i).first(),
    'the User Management workspace renders',
  ).toBeVisible({ timeout: 20_000 });
  // Until the licence summary loads, the "Add New N Channels" button re-renders and a click can be lost.
  await expect(
    page.getByText(/Total Licenses|Free Licenses|Channels/i).first(),
    'the licence / channel summary has loaded',
  ).toBeVisible({ timeout: 20_000 });
  // The app can bounce to /home after rendering; pin the route so that reports as itself.
  await expect(page, 'still on the User Management route').toHaveURL(/\/usermanagement/);
}

/** Opens the "Add Communication Channels" chooser (Add Manually / Bulk-Upload). */
export async function openAddChannelsChooser(page: Page): Promise<void> {
  await openUserManagement(page);
  await page
    .getByText(/Add New\s*\d*\s*Channels/i)
    .first()
    .click();
  await expect(
    page.getByText(/Add Manually|Bulk-?Upload/i).first(),
    'the Add Communication Channels chooser opens',
  ).toBeVisible({ timeout: 15_000 });
}

/** Opens the "Add Manually" member form and returns the modal once its Designation picker is up. */
export async function openAddMemberForm(page: Page): Promise<Locator> {
  await openAddChannelsChooser(page);
  await page
    .getByText(/Add Manually/i)
    .first()
    .click();
  const modal = page.locator('.modal.show, [role="dialog"]').last();
  await expect(modal, 'the Add Manually member form opens').toBeVisible({ timeout: 15_000 });
  await expect(designationControl(modal), 'the Designation picker is rendered').toBeVisible({
    timeout: 10_000,
  });
  await settleAnimations(modal);
  return modal;
}

/** The clickable Designation control (the visible box, not the 4px-wide text input inside it). */
export function designationControl(modal: Locator): Locator {
  return modal.locator('.react-select__control').first();
}

/** Focuses the Designation search and types into it, without choosing anything. */
export async function typeIntoDesignation(page: Page, modal: Locator, text: string): Promise<void> {
  await designationControl(modal).click();
  await page.keyboard.type(text);
}

/** Types a designation, waits for the async search to offer it, picks it, and confirms it stuck. */
export async function chooseDesignation(page: Page, modal: Locator, name: string): Promise<void> {
  await typeIntoDesignation(page, modal, name);
  const exact = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
  const option = page.locator('.react-select__option', { hasText: exact }).first();
  await expect(option, `"${name}" is offered by the Designation search`).toBeVisible({
    timeout: 15_000,
  });
  await option.click();
  await expect(
    modal.locator('.react-select__single-value').first(),
    'the Designation shows as selected',
  ).toHaveText(name);
}

/** Waits for CSS animations inside `root` (e.g. the modal fade) to finish, instead of a fixed sleep. */
export async function settleAnimations(root: Locator): Promise<void> {
  await root
    .evaluate((el) => {
      // Only finite animations can finish (a looping spinner never would); capped as a second guard.
      const finite = el
        .getAnimations({ subtree: true })
        .filter((a) => a.effect?.getTiming().iterations !== Infinity);
      const done = Promise.all(finite.map((a) => a.finished.catch(() => undefined)));
      const cap = new Promise((resolve) => setTimeout(resolve, 2_000));
      return Promise.race([done, cap]);
    })
    .catch(() => undefined);
}
