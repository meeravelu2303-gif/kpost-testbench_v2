import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { parkPointerAwayFromSideMenu } from './katchup';

/**
 * Shared Contacts steps, read from the front-end source (2026-10-11) — the one place these selectors
 * live, so a product change is re-tuned once:
 *
 *   - the Katchup list is a react-bootstrap `Tabs` (`bubble/KKatch/KatchupPage.js`): tab "Contacts";
 *     both panels stay mounted and slide, so the Contacts panel's `SearchBar` (`type="search"`,
 *     placeholder "Search") is the LAST searchbox on the page;
 *   - the Contacts panel's icons (`bubble/ContactList/ContactList.js`): `.icon-KP_107-User-Add` now
 *     NAVIGATES TO `/kdirectory` (the Add-contact wizard is the KDirectory page), and
 *     `.icon-KP_112-Group-Add` opens the "Create New Group" modal;
 *   - KDirectory (`Kdirectory/components/KdirectoryModal/KdirectoryModal.js`): Country and Language
 *     are react-selects, the vertical is a `.dirCategory-box`, "Continue" enables once a vertical is
 *     chosen; the second phase has the people `SearchBar` whose `.icon-KP_225_Advanced-Search`
 *     button opens Advanced Search ("Enter Mobile Number", "Search"); results are `ContactBar`s with
 *     checkboxes and an "Add To Contact" button.
 *
 * Why the 2026-10 re-tune: until then every Contacts spec carried a private copy of these steps that
 * clicked "Personal" straight after the add icon — the page it navigates to needs Country and
 * Language first, so all 22 sites skipped as "did not open on this build".
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
