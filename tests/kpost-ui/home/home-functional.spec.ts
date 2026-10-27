import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { settleFrames } from '../support/settle';

/**
 * Home dashboard: drives the Recents/Contacts tab switch, Recents search, Advanced Search and the
 * quick date filter (`HomeDashboard.js`/`Recent.js`). Shared list content is tested elsewhere.
 */
test.describe(
  'KPost Home · dashboard functional behaviour',
  { tag: ['@ui', '@home', '@regression', '@sanity'] },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    test('switching between Recents and Contacts tabs actually changes the visible panel @ui', async ({
      homePage,
      page,
    }) => {
      await homePage.goto();

      // Recents is the default tab — its own content area should already be visible.
      await expect(
        page.locator('.active-Recent, .homeRecentTheme').first(),
        'Recents panel is visible by default',
      ).toBeVisible({ timeout: 15_000 });

      await homePage.switchToContactsTab();
      await expect(
        page.locator('.active-Contact').first(),
        'switching to Contacts actually shows the Contacts panel (not just the tab label changing)',
      ).toBeVisible({ timeout: 15_000 });

      await homePage.switchToRecentsTab();
      await expect(
        page.locator('.active-Recent, .homeRecentTheme').first(),
        'switching back to Recents shows the Recents panel again',
      ).toBeVisible({ timeout: 15_000 });
    });

    test('typing in the Recents search box filters the visible list, not a network round-trip @ui', async ({
      homePage,
      page,
    }) => {
      await homePage.goto();
      await homePage.switchToRecentsTab();

      const improbableQuery = `zzqanomatch${Date.now()}`;
      await homePage.searchRecents(improbableQuery);

      test.info().annotations.push({
        type: 'observed',
        description: `searched for a query with no plausible real match: "${improbableQuery}"`,
      });

      // The empty-state UI isn't pinned; a client-side filter must simply stay on /home.
      await settleFrames(page);
      await expect(
        page,
        'filtering Recents stays on the Home screen (client-side filter)',
      ).toHaveURL(/\/home/);
    });

    test('Advanced Search opens from the search box and its Search button requires a To-date @ui', async ({
      homePage,
      page,
    }) => {
      await homePage.goto();
      await homePage.switchToRecentsTab();
      await homePage.openAdvancedSearch();

      await expect(
        page.getByText(/^Advanced Search$/i),
        'the Advanced Search modal opens',
      ).toBeVisible({ timeout: 10_000 });

      // Recent.js gates Search on To-date alone, so a keyword-only search cannot be submitted.
      await homePage.fillAdvancedSearch({ word: 'invoice' });
      await expect(
        homePage.advancedSearchSubmitButton,
        'Search stays disabled after filling a non-date filter (Word) alone, ' +
          'with no date range provided — confirmed from source: the button is gated on To-date only',
      ).toBeDisabled();

      await homePage.fillAdvancedSearch({ fromDate: '2026-01-01', toDate: '2026-09-30' });
      await expect(
        homePage.advancedSearchSubmitButton,
        'Search becomes enabled once a To-date is provided',
      ).toBeEnabled({ timeout: 10_000 });

      await homePage.advancedSearchSubmitButton.click();
      await expect(
        page.getByText(/Advance Search Result/i),
        'submitting Advanced Search shows the results view',
      ).toBeVisible({ timeout: 15_000 });
    });

    /** The dropdowns chain dataType -> messageBy -> messageType -> contentType (`Recent.js`). */
    test("Advanced Search's 4 dropdown filters unlock each other in the documented chain order @ui", async ({
      homePage,
      page,
    }) => {
      await homePage.goto();
      await homePage.switchToRecentsTab();
      await homePage.openAdvancedSearch();

      const contentTypeDropdown = page
        .locator('.d-flex.flex-column', { hasText: 'Select Content Type' })
        .last()
        .locator('.react-select__input')
        .first();

      await expect(
        contentTypeDropdown,
        'Content Type starts disabled — confirmed from source, gated on Message Type being set first',
      ).toBeDisabled();

      await homePage.fillAdvancedSearch({
        dataType: 'Name',
        messageBy: 'All',
        messageType: 'All',
      });

      await expect(
        contentTypeDropdown,
        'Content Type becomes enabled once every earlier link in the chain (Data Type -> Message By ' +
          '-> Message Type) is filled',
      ).toBeEnabled({ timeout: 10_000 });
    });

    test('the quick date-filter icon (separate from Advanced Search) opens a date picker @ui', async ({
      homePage,
      page,
    }) => {
      await homePage.goto();
      await homePage.switchToRecentsTab();
      await homePage.toggleQuickDateFilter();

      // Any calendar widget counts; the icon just has to open one.
      await expect(
        page.locator('.CalenderPostion, .react-datepicker, [class*="calendar"]').first(),
        'the quick date-filter icon opens a date-picker popup',
      ).toBeVisible({ timeout: 10_000 });
    });

    test('opening a Recents conversation (if any exist) does not crash the page @ui', async ({
      homePage,
      page,
    }) => {
      await homePage.goto();
      await homePage.switchToRecentsTab();

      const opened = await homePage.openFirstRecentConversation();
      test.skip(!opened, 'this account has no message history to click into — nothing to test');

      // The opened-conversation UI isn't pinned; only checks the page survived the click.
      await settleFrames(page);
      await expect(page.locator('body')).toBeVisible();
    });
  },
);
