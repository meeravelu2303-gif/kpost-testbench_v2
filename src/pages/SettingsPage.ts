import type { Page } from '@playwright/test';
import { test } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * The Settings nav accordion (`Settingdetails.js`): one group open at a time, and nested panels are
 * reachable only once their group is expanded. The profile panel is always shown above the nav.
 */
export class SettingsPage extends BasePage {
  readonly path = '/settings';

  constructor(page: Page) {
    super(page);
  }

  async expectLoaded(): Promise<void> {
    await this.page
      .locator('.settings-theme-shell, .settings-theme-nav-panel')
      .first()
      .waitFor({ state: 'visible', timeout: 20_000 });
    await this.page
      .locator('.loader-overlay')
      .waitFor({ state: 'hidden', timeout: 30_000 })
      .catch(() => undefined);
  }

  /** Expand a top-level nav group by its exact label (e.g. "General Settings", "KMail Settings"). */
  async expandGroup(groupLabel: string): Promise<void> {
    await test.step(`Settings: expand "${groupLabel}"`, async () => {
      await this.page.getByText(groupLabel, { exact: true }).first().click();
    });
  }

  /** Click a nested nav item by its exact label, once its parent group is expanded. */
  async openNestedPanel(itemLabel: string): Promise<void> {
    await test.step(`Settings: open "${itemLabel}"`, async () => {
      await this.page.getByText(itemLabel, { exact: true }).first().click();
    });
  }

  /** Expand a group then open one of its nested items in one call. */
  async openPanel(groupLabel: string, itemLabel: string): Promise<void> {
    await this.expandGroup(groupLabel);
    await this.openNestedPanel(itemLabel);
  }

  /** "Digital Card Settings" and "KNews Settings" — top-level, single click, no expand step. */
  async openTopLevelPanel(label: string): Promise<void> {
    await test.step(`Settings: open top-level "${label}"`, async () => {
      await this.page.getByText(label, { exact: true }).first().click();
    });
  }
}
