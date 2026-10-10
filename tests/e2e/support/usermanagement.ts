import { expect } from '@fixtures';
import type { Locator, Page } from '@playwright/test';

/**
 * Shared navigation for the BUSINESS_S company-admin **User Management** screen (`/usermanagement`)
 * and its "Add Manually" member form. Three specs (`usermanagement*.spec.ts`) used to carry their
 * own copy of this flow, each padded with fixed sleeps and a forced click on the zero-width
 * `react-select__input`; all three now share this one, which waits on what the screen actually does.
 *
 * Re-tuned live on the test deployment, 2026-10-10. What the form looks like today:
 *
 *  - Designation is an async-search react-select. Its `<input>` is 4px wide (why the old specs had
 *    to force-click it); the surrounding `.react-select__control` is the real 500px-wide target.
 *  - Choosing a Designation auto-fills two read-only fields (a display name and a unique name
 *    derived from company + designation) and enables Mobile No.
 *  - Mobile No's placeholder is now "Enter 10-digit Mobile No (country code optional)"; the old
 *    "Enter Mobile No with Country Code" selector matched nothing, which is why the collision test
 *    had been skipping with "the Mobile No field did not enable".
 *
 * Every helper stops short of ADD: completing the form provisions a real member account.
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
  // The licence summary is rendered from the company data the screen fetches after mount. Until it
  // is there, the "Add New N Channels" button is still being re-rendered with its count, and a click
  // on it can be lost (seen live 2026-10-10: the chooser never opened, passed on retry).
  await expect(
    page.getByText(/Total Licenses|Free Licenses|Channels/i).first(),
    'the licence / channel summary has loaded',
  ).toBeVisible({ timeout: 20_000 });
  // Seen live 2026-10-10 (1 of 4 openings): the screen rendered, then the app itself navigated to
  // /home, and the next click landed on the Home screen. Pinning the route here makes that bounce
  // report as what it is, not as "the chooser did not open".
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

/**
 * Waits for the CSS transitions/animations running inside `root` (Bootstrap's modal fade, for one)
 * to finish — the honest replacement for "sleep a second so the modal has stopped moving" before an
 * axe scan or a screenshot.
 */
export async function settleAnimations(root: Locator): Promise<void> {
  await root
    .evaluate((el) => {
      // Only finite animations can finish; a looping spinner would make this wait forever
      // (found live 2026-10-10 when this was pointed at <body>). Capped as a second guard.
      const finite = el
        .getAnimations({ subtree: true })
        .filter((a) => a.effect?.getTiming().iterations !== Infinity);
      const done = Promise.all(finite.map((a) => a.finished.catch(() => undefined)));
      const cap = new Promise((resolve) => setTimeout(resolve, 2_000));
      return Promise.race([done, cap]);
    })
    .catch(() => undefined);
}
