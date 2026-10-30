import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { gotoKatchup, parkPointerAwayFromSideMenu } from './katchup';

/**
 * Shared Contacts steps (Katchup's Contacts tab, the Add-contact → KDirectory wizard, Create Group),
 * so these selectors live in one place.
 */

/** Open Katchup's Contacts tab; true when the Contacts panel (its search box) is showing. */
export async function gotoContacts(page: Page): Promise<boolean> {
  await page.goto('/katchup', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page
    .locator('.loader-overlay')
    .waitFor({ state: 'hidden', timeout: 30_000 })
    .catch(() => undefined);
  await parkPointerAwayFromSideMenu(page);
  const tab = page.getByRole('tab', { name: 'Contacts' });
  const clicked = await tab
    .click({ timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (!clicked) return false;
  return contactsSearchBox(page)
    .isVisible({ timeout: 15_000 })
    .catch(() => false);
}

/** The Contacts panel's own "Search" box (the Recents panel's identical box renders first). */
export function contactsSearchBox(page: Page): Locator {
  return page.getByRole('searchbox', { name: 'Search' }).last();
}

/** react-select: the placeholder is covered by the input container, so type into the input. */
async function pickReactSelect(page: Page, placeholder: RegExp, option: string): Promise<void> {
  const control = page.locator('.react-select__control').filter({ hasText: placeholder }).first();
  await expect(control, `the "${placeholder.source}" selector renders`).toBeVisible({
    timeout: 15_000,
  });
  await control.locator('input').first().fill(option);
  const match = page
    .locator('.react-select__option')
    .filter({ hasText: new RegExp(option, 'i') })
    .first();
  await expect(match, `"${option}" is offered`).toBeVisible({ timeout: 15_000 });
  await match.click();
}

/**
 * From the Contacts tab, the Add-contact icon → KDirectory → Country / Language / vertical →
 * Continue → the people-search step. Returns that step's search box, or null with the reason set on
 * `last` when a step did not render.
 */
export async function openPeopleSearch(
  page: Page,
  options: { country?: string; language?: string; vertical?: string } = {},
): Promise<Locator | null> {
  const country = options.country ?? 'India';
  const language = options.language ?? 'English';
  const vertical = options.vertical ?? 'Personal';
  const add = page.locator('.icon-KP_107-User-Add').first();
  const started = await add
    .click({ timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (!started) return null;
  await expect(page, 'the Add-contact icon opens KDirectory').toHaveURL(/\/kdirectory/, {
    timeout: 15_000,
  });
  await parkPointerAwayFromSideMenu(page);
  await pickReactSelect(page, /Select Country/i, country);
  await pickReactSelect(page, /Choose Language/i, language);
  await page
    .locator('.dirCategory-box, .selectedCategory-box')
    .filter({ hasText: new RegExp(`^${vertical}$`) })
    .first()
    .click();
  const cont = page.getByRole('button', { name: /^Continue$/i });
  await expect(cont, 'Continue is enabled once a vertical is chosen').toBeEnabled({
    timeout: 10_000,
  });
  await cont.click();
  const search = page.getByRole('searchbox').first();
  const reached = await search.isVisible({ timeout: 15_000 }).catch(() => false);
  return reached ? search : null;
}

/** From the people-search step, the Advanced Search button → the mobile-number field (or null). */
export async function openAdvancedSearch(page: Page): Promise<Locator | null> {
  const trigger = page.locator('.icon-KP_225_Advanced-Search').first();
  const clicked = await trigger
    .click({ timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (!clicked) return null;
  // The field is a labelled `Input` ("Mobile Number") whose placeholder is the stable handle.
  const mobile = page.getByPlaceholder('Enter Mobile Number').first();
  const reached = await mobile.isVisible({ timeout: 15_000 }).catch(() => false);
  return reached ? mobile : null;
}

/** From the Contacts tab, the Create-group icon → the "Create New Group" modal (or null). */
export async function openCreateGroup(page: Page): Promise<Locator | null> {
  const clicked = await page
    .locator('.icon-KP_112-Group-Add')
    .first()
    .click({ timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (!clicked) return null;
  const modal = page.getByRole('dialog').filter({ hasText: /Create New Group/i });
  const opened = await modal.isVisible({ timeout: 15_000 }).catch(() => false);
  return opened ? modal : null;
}

/** Katchup's contact rail → the person's avatar → their Digital Card (`name` as the rail shows it). */
export async function openDigitalCard(page: Page, name: string): Promise<Locator> {
  await gotoKatchup(page);
  await page
    .getByRole('searchbox')
    .first()
    .fill(name)
    .catch(() => undefined);
  const row = page
    .locator('.contactBar_Dropdown')
    .filter({ hasText: new RegExp(name, 'i') })
    .first();
  const card = page.locator('.DC-modal-40w').first();
  const opened = page.waitForResponse((r) => r.url().includes('/profile/getDigitalCard'), {
    timeout: 30_000,
  });
  await row.locator('.sb-avatar').first().click();
  await opened;
  await expect(card, `${name}'s Digital Card opens`).toBeVisible({ timeout: 15_000 });
  return card;
}
