import type { Page } from '@playwright/test';
import { test } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * The Admin/HR-Setup UI (`kpostadmin.kpostindia.com`, a CoreUI-Pro SPA, ADMIN_HR_MODULES_25).
 * SSO'd by `auth-admin.setup.ts` — never logs in through its own `Login.js`.
 *
 * Employee Management (`/employee-management`) is a 6-tab `CNav variant="pills"` strip (Promote,
 * Transfer, Suspend, Revoke, Terminate, History) — each tab is its own component with its own
 * "<Action> Employee" text button (an `IconControl` `txtBtn`, a plain clickable `<div>`, not a real
 * `<button>`) that reveals a form with a `KDropdown` (a `react-select` wrapper, confirmed from
 * source) to pick an employee. Once picked, every one of the 5 live tabs renders an identical
 * "employee card" panel that includes the employee's PAN card number as plain, unmasked text
 * (confirmed from source: `Suspend.js` line ~423, `<div>{selectedEmployee.panCard}</div>`, no
 * masking of any kind) — the same pattern repeats across Promote/Transfer/Revoke/Terminate.
 */
export class AdminPage extends BasePage {
  readonly path = '/employee-management';

  constructor(page: Page) {
    super(page);
  }

  async expectLoaded(): Promise<void> {
    await this.page.locator('.sidebar-nav').first().waitFor({ state: 'visible', timeout: 20_000 });
    await this.page
      .locator('.loader-overlay')
      .waitFor({ state: 'hidden', timeout: 30_000 })
      .catch(() => undefined);
  }

  /** Click one of the 6 Employee Management tabs by its exact label. */
  async openTab(
    label: 'Promote' | 'Transfer' | 'Suspend' | 'Revoke' | 'Terminate' | 'History',
  ): Promise<void> {
    await test.step(`Employee Management: open "${label}" tab`, async () => {
      await this.page.locator('.nav-pills .nav-link', { hasText: label }).first().click();
    });
  }

  /** Click the tab's own "<Action> Employee" button to reveal the employee-picker form. */
  async openActionForm(actionLabel: string): Promise<void> {
    await test.step(`Employee Management: open "${actionLabel}" form`, async () => {
      await this.page.getByText(actionLabel, { exact: true }).first().click();
    });
  }

  /**
   * Pick the first option in the employee dropdown. This app's `KDropdown` wraps `react-select`
   * WITHOUT a `classNamePrefix` (confirmed from source, `src/Common/KDropdown.js`) — unlike the main
   * KPost app's own react-select usage, there is no `.react-select__*` BEM class here at all, only
   * react-select's own ARIA roles. Returns whether an employee was actually selectable (false when
   * the company has no assigned employees to pick from — confirmed live 2026-10-05 that BUSINESS_M
   * has zero role postings, so this returns false every time until real data exists).
   */
  async selectFirstEmployee(): Promise<boolean> {
    return test.step('Employee Management: select the first available employee', async () => {
      const combo = this.page.getByRole('combobox').first();
      const opened = await combo.isVisible({ timeout: 10_000 }).catch(() => false);
      if (!opened) return false;
      await combo.click({ force: true });
      await this.page.waitForTimeout(400);
      const firstOption = this.page.getByRole('option').first();
      const hasOption = await firstOption.isVisible({ timeout: 5_000 }).catch(() => false);
      if (!hasOption) return false;
      await firstOption.click();
      return true;
    });
  }

  /**
   * The employee-card panel's visible PAN card text, once an employee is selected. Matched by PAN's
   * own strict format (5 letters, 4 digits, 1 letter — e.g. "ABCDE1234F") rather than a CSS class,
   * since that format can't appear anywhere else on this screen by accident.
   */
  async visiblePanCardText(): Promise<string | null> {
    const panRow = this.page.getByText(/^[A-Z]{5}\d{4}[A-Z]$/).first();
    const visible = await panRow.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!visible) return null;
    return panRow.textContent();
  }
}
