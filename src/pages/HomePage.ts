import type { Page } from '@playwright/test';
import { test } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * The Home screen's OWN dashboard — the Recents/Contacts tab switcher (`HomeDashboard.js`) and the
 * Recents tab's search + Advanced Search (`Recent.js`). Deliberately scoped narrow: the Contacts tab
 * renders Katchup's own shared `Contact` component (already covered by `contacts*.spec.ts`), and the
 * Recents list itself renders the shared `RecentMessage` component (already covered by
 * `katchup*.spec.ts`) — this page object only owns what is unique to Home: the tab switch and the
 * search/filter UI wrapped around that shared list.
 *
 * NEEDS-LIVE-TUNING: built from source (`KPOST_REACTJS_2023_V1`'s `HomeDashboard.js`/`Recent.js`),
 * not a codegen recording — remove this note once a run has confirmed the selectors below.
 */
export class HomePage extends BasePage {
  readonly path = '/home';

  constructor(page: Page) {
    super(page);
  }

  /** The signed-in header (avatar pill) is the fastest confirmation a session is live on Home. */
  async expectLoaded(): Promise<void> {
    await this.page.locator('.header-user-pill').first().waitFor({ state: 'visible', timeout: 20_000 });
    await this.page
      .locator('.loader-overlay')
      .waitFor({ state: 'hidden', timeout: 30_000 })
      .catch(() => undefined);
  }

  /** `HomeDashboard.js`'s two `react-bootstrap` Tabs — addressed by their own title text. */
  async switchToRecentsTab(): Promise<void> {
    await test.step('Home: switch to Recents tab', async () => {
      await this.page.getByRole('tab', { name: /^Recents$/i }).click();
    });
  }

  async switchToContactsTab(): Promise<void> {
    await test.step('Home: switch to Contacts tab', async () => {
      await this.page.getByRole('tab', { name: /^Contacts$/i }).click();
    });
  }

  /**
   * Types into the Recents search box — a pure client-side filter on the already-loaded message
   * list (`Recent.js` passes `searchQuery` straight into `RecentMessage` as a prop), NOT a network
   * call and NOT the same thing as opening Advanced Search (see `openAdvancedSearch` below).
   */
  async searchRecents(query: string): Promise<void> {
    await test.step(`Home: filter recents by "${query}"`, async () => {
      // Both the Recents and Contacts tab panels stay mounted (same pattern documented in
      // contacts.spec.ts) - each with its own "Search" placeholder. Recents renders first in the
      // DOM, so `.first()` is the on-screen Recents copy when that tab is active (Home's default).
      await this.page.getByPlaceholder('Search').first().fill(query);
    });
  }

  /**
   * Opens the Advanced Search modal via its own dedicated icon button
   * (`.icon-KP_225_Advanced-Search`), next to the mic icon in the Recents search bar.
   *
   * Found live 2026-10-01 (after a deploy): clicking the search placeholder itself no longer opens
   * Advanced Search — confirmed via DOM inspection that the search box, mic, and Advanced Search are
   * now three separate controls. Previously the placeholder click doubled as the trigger; that is no
   * longer true, so this targets the dedicated icon directly instead.
   */
  async openAdvancedSearch(): Promise<void> {
    await test.step('Home: open Advanced Search', async () => {
      await this.page.locator('.icon-KP_225_Advanced-Search').first().click();
      await this.page.getByText(/^Advanced Search$/i).waitFor({ state: 'visible', timeout: 10_000 });
    });
  }

  /**
   * Fills any subset of Advanced Search's fields. Confirmed from source: the "Search" submit button
   * stays `isDisabled` until "To" (a date) is filled — REGARDLESS of which other fields are set. That
   * is asserted on directly in `home-functional.spec.ts` as its own finding, not silently worked
   * around here, since a non-date search (e.g. "Enter Word" only) being unable to submit without
   * ALSO picking a date range is exactly the kind of thing worth surfacing.
   *
   * The four dropdowns are react-select (`common/Select/Select.js` — confirmed
   * `classNamePrefix="react-select"`, same as Signup's own) AND form a CHAIN of dependencies,
   * confirmed from source — filling them out of order does nothing, since the later one is still
   * `isDisabled`:
   *   dataType  ->  enables messageBy  ->  enables messageType  ->  enables contentType
   * This method always fills them in that order regardless of the order given in `filters`.
   *
   * Found live 2026-10-01 (after a deploy): "Enter Word" itself is now disabled until ALL FOUR
   * dropdowns are filled — previously it was reachable independently of the chain (see the filed
   * ticket on this). So whenever `word` is requested without the caller also naming all four
   * dropdowns, this defaults every unset one to "All" purely to reach the field — a test-plumbing
   * concession, not a statement that "All" is what a real user would pick.
   */
  async fillAdvancedSearch(filters: {
    dataType?: string;
    messageType?: string;
    word?: string;
    messageBy?: string;
    contentType?: string;
    fromDate?: string;
    toDate?: string;
  }): Promise<void> {
    await test.step('Home: fill Advanced Search filters', async () => {
      // "All" only stands in for a dropdown the caller never named, and only when `word` needs the
      // full chain completed to unlock — a caller testing the chain itself (no `word`) still gets
      // the exact, untouched subset it asked for.
      const fallback = filters.word ? 'All' : undefined;
      const dataType = filters.dataType ?? fallback;
      const messageBy = filters.messageBy ?? fallback;
      const messageType = filters.messageType ?? fallback;
      const contentType = filters.contentType ?? fallback;

      if (dataType) await this.chooseAdvancedSearchDropdown('Select by Data Type', dataType);
      if (messageBy) await this.chooseAdvancedSearchDropdown('Select Message by', messageBy);
      if (messageType) await this.chooseAdvancedSearchDropdown('Select Type of Message', messageType);
      if (contentType) await this.chooseAdvancedSearchDropdown('Select Content Type', contentType);
      if (filters.word) await this.page.getByPlaceholder('Enter Word').fill(filters.word);
      if (filters.fromDate) await this.page.getByPlaceholder('From').fill(filters.fromDate);
      if (filters.toDate) await this.page.getByPlaceholder('To').fill(filters.toDate);
    });
  }

  /**
   * Opens one of Advanced Search's 4 react-select dropdowns (addressed by its own placeholder text,
   * since all 4 share the exact same underlying widget) and commits the option matching `label`.
   * Multiple react-selects are mounted at once here (unlike Signup's single-select-at-a-time
   * screens), so this locates the SPECIFIC input belonging to the labelled dropdown rather than
   * addressing by position.
   */
  private async chooseAdvancedSearchDropdown(placeholderLabel: string, optionLabel: string): Promise<void> {
    const container = this.page.locator('.d-flex.flex-column', { hasText: placeholderLabel }).last();
    const input = container.locator('.react-select__input').first();
    await input.click({ force: true });
    await this.page.waitForTimeout(300);
    await this.page.keyboard.type(optionLabel);
    await this.page.waitForTimeout(300);
    await this.page.keyboard.press('Enter');
    await this.page.waitForTimeout(300);
  }

  /**
   * The separate quick date-filter icon next to the search box (`Datefun`/`Date.js`,
   * `.Date_alignment` — distinct from Advanced Search's own From/To date fields). Confirms it opens
   * a date-picker popup; does not drive full date selection.
   */
  async toggleQuickDateFilter(): Promise<void> {
    await test.step('Home: toggle the quick date-filter icon', async () => {
      await this.page.locator('.Date_alignment').first().click();
    });
  }

  /**
   * The Recents list's own items — confirmed from source (`RecentMessage.js`) to call
   * `onDataFromChild1_1_1(object)` on click, which Home wires up to open that conversation. Returns
   * `false` (rather than throwing) when the list is empty, so a caller can skip cleanly instead of
   * failing on an account with no message history.
   */
  async openFirstRecentConversation(): Promise<boolean> {
    return test.step('Home: open the first Recents item', async () => {
      const items = this.page.locator('.RecentMessage, [class*="recent-msg"], [class*="RecentMessage"]');
      const count = await items.count();
      if (count === 0) return false;
      await items.first().click();
      return true;
    });
  }

  /** The Advanced Search "Search" button — disabled until a "To" date is set (see the doc above). */
  get advancedSearchSubmitButton() {
    return this.page.getByRole('button', { name: /^Search$/i });
  }

  async closeAdvancedSearch(): Promise<void> {
    await test.step('Home: close Advanced Search', async () => {
      // ModalComponent's own close affordance (an X, confirmed pattern elsewhere in this app) —
      // scoped to the open modal so it can't match an unrelated close icon on the page behind it.
      await this.page
        .locator('.modal, [role="dialog"]')
        .filter({ has: this.page.getByText(/Advanced Search/i) })
        .locator('[class*="close"], .btn-close')
        .first()
        .click();
    });
  }
}
