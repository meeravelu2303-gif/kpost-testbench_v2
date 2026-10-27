import type { Page } from '@playwright/test';
import { test } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * The Home dashboard's own controls: the Recents/Contacts tabs and the Recents search and Advanced
 * Search (`HomeDashboard.js`, `Recent.js`). The shared contact and message lists belong to other
 * page objects.
 */
export class HomePage extends BasePage {
  readonly path = '/home';

  constructor(page: Page) {
    super(page);
  }

  /** The signed-in header (avatar pill) is the fastest confirmation a session is live on Home. */
  async expectLoaded(): Promise<void> {
    await this.page
      .locator('.header-user-pill')
      .first()
      .waitFor({ state: 'visible', timeout: 20_000 });
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
   * Types into the Recents search box: a client-side filter, not a network call or Advanced Search.
   */
  async searchRecents(query: string): Promise<void> {
    await test.step(`Home: filter recents by "${query}"`, async () => {
      // Both tab panels stay mounted with a "Search" box; Recents renders first.
      await this.page.getByPlaceholder('Search').first().fill(query);
    });
  }

  /**
   * Opens Advanced Search via its own icon button (`.icon-KP_225_Advanced-Search`) beside the mic.
   */
  async openAdvancedSearch(): Promise<void> {
    await test.step('Home: open Advanced Search', async () => {
      await this.page.locator('.icon-KP_225_Advanced-Search').first().click();
      await this.page
        .getByText(/^Advanced Search$/i)
        .waitFor({ state: 'visible', timeout: 10_000 });
    });
  }

  /**
   * Fills any subset of Advanced Search. The dropdowns form a chain (dataType → messageBy →
   * messageType → contentType), so they are filled in that order. "Enter Word" unlocks only when
   * all four are set, so unset ones default to "All" when `word` is given. Search stays disabled
   * until "To" is set.
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
      // Without `word`, the caller gets exactly the subset it asked for.
      const fallback = filters.word ? 'All' : undefined;
      const dataType = filters.dataType ?? fallback;
      const messageBy = filters.messageBy ?? fallback;
      const messageType = filters.messageType ?? fallback;
      const contentType = filters.contentType ?? fallback;

      if (dataType) await this.chooseAdvancedSearchDropdown('Select by Data Type', dataType);
      if (messageBy) await this.chooseAdvancedSearchDropdown('Select Message by', messageBy);
      if (messageType)
        await this.chooseAdvancedSearchDropdown('Select Type of Message', messageType);
      if (contentType) await this.chooseAdvancedSearchDropdown('Select Content Type', contentType);
      if (filters.word) await this.page.getByPlaceholder('Enter Word').fill(filters.word);
      if (filters.fromDate) await this.page.getByPlaceholder('From').fill(filters.fromDate);
      if (filters.toDate) await this.page.getByPlaceholder('To').fill(filters.toDate);
    });
  }

  /** Commits `label` in one Advanced Search dropdown, found by its placeholder. */
  private async chooseAdvancedSearchDropdown(
    placeholderLabel: string,
    optionLabel: string,
  ): Promise<void> {
    const container = this.page
      .locator('.d-flex.flex-column', { hasText: placeholderLabel })
      .last();
    const input = container.locator('.react-select__input').first();
    await input.click({ force: true });
    await this.page.waitForTimeout(300);
    await this.page.keyboard.type(optionLabel);
    await this.page.waitForTimeout(300);
    await this.page.keyboard.press('Enter');
    await this.page.waitForTimeout(300);
  }

  /** Opens the quick date-filter popup beside the search box (not Advanced Search's From/To). */
  async toggleQuickDateFilter(): Promise<void> {
    await test.step('Home: toggle the quick date-filter icon', async () => {
      await this.page.locator('.Date_alignment').first().click();
    });
  }

  /** Opens the first Recents conversation; `false` when the list is empty, so callers can skip. */
  async openFirstRecentConversation(): Promise<boolean> {
    return test.step('Home: open the first Recents item', async () => {
      const items = this.page.locator(
        '.RecentMessage, [class*="recent-msg"], [class*="RecentMessage"]',
      );
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
      // The modal's own close X, scoped so it cannot match a close icon behind it.
      await this.page
        .locator('.modal, [role="dialog"]')
        .filter({ has: this.page.getByText(/Advanced Search/i) })
        .locator('[class*="close"], .btn-close')
        .first()
        .click();
    });
  }
}
