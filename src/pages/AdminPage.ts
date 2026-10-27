import type { Page } from '@playwright/test';
import { test } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * The Admin/HR-Setup UI's Employee Management screen (signed in by `auth-admin.setup.ts`): six
 * action tabs, each with an "<Action> Employee" div that opens an employee picker and an employee
 * card showing PAN.
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
   * Picks the first employee via react-select's ARIA roles (this `KDropdown` has no class prefix).
   * Returns false when the company has no employees to pick.
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

  /** The employee card's visible PAN text, matched by PAN's strict format (e.g. "ABCDE1234F"). */
  async visiblePanCardText(): Promise<string | null> {
    const panRow = this.page.getByText(/^[A-Z]{5}\d{4}[A-Z]$/).first();
    const visible = await panRow.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!visible) return null;
    return panRow.textContent();
  }
}
