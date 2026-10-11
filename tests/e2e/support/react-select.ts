import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/**
 * react-select, driven the way a user drives it — without forced clicks or fixed waits.
 *
 * Why this exists (2026-10-11): a dozen specs clicked the PLACEHOLDER TEXT with `force: true` and
 * then slept 250–1000 ms before typing, because react-select's input container sits over the
 * placeholder and intercepts the pointer ("intercepts pointer events"). The reliable handle is the
 * control's own `<input>`: filling it opens the menu and filters it, and the option can then be
 * clicked normally. Every step is an actionability/visibility wait, never a timer.
 *
 *   - `reactSelectByPlaceholder(page, /Select Country/i)` → the `.react-select__control` showing
 *     that placeholder (or current value);
 *   - `pickReactSelect(control, 'India')` → type into its input, click the matching
 *     `.react-select__option`, and confirm the menu closed.
 */
export function reactSelectByPlaceholder(page: Page, placeholder: RegExp | string): Locator {
  return page.locator('.react-select__control').filter({ hasText: placeholder }).first();
}

export async function pickReactSelect(
  control: Locator,
  option: string | RegExp,
  options: { page?: Page; multi?: boolean; typeToFilter?: boolean } = {},
): Promise<void> {
  const page = options.page ?? control.page();
  await expect(control, 'the react-select control renders').toBeVisible({ timeout: 15_000 });
  const input = control.locator('input').first();
  if (options.typeToFilter === false || typeof option !== 'string') {
    // Open without filtering (some lists load their options only once opened).
    await input.focus();
    await page.keyboard.press('ArrowDown');
  } else {
    await input.fill(option);
  }
  const pattern = typeof option === 'string' ? new RegExp(escape(option), 'i') : option;
  const menu = page.locator('.react-select__menu');
  await expect(menu.first(), 'the options menu opens').toBeVisible({ timeout: 15_000 });
  // Standard options carry `.react-select__option`; custom Option components (the KNews checkbox
  // lists) do not, so fall back to the option's text inside the open menu.
  const standard = menu.locator('.react-select__option').filter({ hasText: pattern }).first();
  const match = (await standard.count()) ? standard : menu.getByText(pattern).first();
  await expect(match, `"${String(option)}" is offered`).toBeVisible({ timeout: 15_000 });
  await match.click();
  // An `isMulti` list stays open after a pick; Escape commits and closes it.
  if (options.multi) await page.keyboard.press('Escape');
  await expect(page.locator('.react-select__menu'), 'the menu closes after picking').toHaveCount(
    0,
    {
      timeout: 5_000,
    },
  );
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
