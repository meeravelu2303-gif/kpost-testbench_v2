import type { Locator, Page } from '@playwright/test';

/**
 * Settings › Profile Creation. The settings screen renders twice (a desktop and a hidden mobile copy),
 * so every step is scoped to the desktop panels.
 */
export const PROFILE_PANEL = '.col-md-9.settings-theme-content-panel';

/** Opens Settings › Profile Creation › `section` and returns the desktop content panel. */
export async function openProfileSection(page: Page, section: string): Promise<Locator> {
  await page.goto('/settings', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page
    .locator('.loader-overlay')
    .waitFor({ state: 'hidden', timeout: 30_000 })
    .catch(() => undefined);
  const menu = page.locator('.col-md-3.settings-theme-nav-panel');
  const item = menu.getByText(section, { exact: true }).first();
  // The menu is an accordion: open "Profile Creation" only if its children are hidden.
  if (!(await item.isVisible().catch(() => false))) {
    await menu.getByText('Profile Creation', { exact: true }).first().click({ timeout: 15_000 });
  }
  await item.click({ timeout: 15_000 });
  return page.locator(PROFILE_PANEL).first();
}
