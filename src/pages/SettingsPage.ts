import type { Page } from '@playwright/test';
import { test } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * The Settings screen's nav accordion (`Settingdetails.js`) — confirmed from source: clicking a
 * top-level group (e.g. "General Settings") toggles it open and explicitly closes every sibling
 * group (each handler sets every other group's boolean state to `false`), so only one group can be
 * expanded at a time. A panel nested under a group is only clickable/visible once its parent group
 * is expanded.
 *
 * Two panels are NOT reached via this nav at all:
 *  - `SettingProfile` (cover/avatar) is always rendered above the nav tree (`showProfile` defaults
 *    `true` in `Setting.js`) — visible immediately on `/settings`, no click needed.
 *  - "Digital Card Settings" and "KNews Settings" are top-level, single-click items with no expand
 *    step (no nested children in this file).
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
