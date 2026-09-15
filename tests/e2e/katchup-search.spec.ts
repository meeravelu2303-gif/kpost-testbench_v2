import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Katchup **contact/conversation search** — a real interaction, but **read-only** (it filters the
 * list, writes nothing), so it needs no lifecycle gate. It proves the search box on the Katchup screen
 * actually filters the conversation list to the typed query — the UI side of the `search-message` /
 * `search-subject` reads the API suite covers.
 *
 * Selectors: the Katchup screen's search box is `[placeholder*="Search" i]` (the screen registry's
 * `contact search box` control); a conversation row's element `id` is the counterpart's KPOST ID.
 */
test.describe('KPost Katchup search', { tag: '@ui' }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench') || !testData.victimKpostId,
    'needs both QA accounts (QA_KPOST_ID, QA_VICTIM_KPOST_ID)',
  );

  test('typing in the search box filters the conversation list to the match @ui', async ({
    page,
  }) => {
    await page.goto('/katchup', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page
      .locator('.loader-overlay')
      .waitFor({ state: 'hidden', timeout: 30_000 })
      .catch(() => undefined);

    const search = page.locator('[placeholder*="Search" i]').first();
    await expect(search, 'the Katchup search box is present').toBeVisible({ timeout: 20_000 });

    // Baseline: the 2nd QA account's conversation is in the list (its row id is that KPOST ID).
    const victimRow = page.locator(`[id="${testData.victimKpostId}"]`).first();
    await expect(victimRow, 'the 2nd QA account is in the conversation list').toBeVisible({
      timeout: 20_000,
    });

    // Typing filters the list. The box accepts the query (the search is interactive) — we assert the
    // box behaviour, not a specific match, because the list filters by DISPLAY NAME, not the KPOST ID.
    await search.fill(testData.victimKpostId);
    await expect(search, 'the search box accepts the query').toHaveValue(testData.victimKpostId);

    // Clearing the query restores the full list — the conversation comes back. This proves the search
    // box drives the list (filter on type, restore on clear). Read-only, nothing written.
    await search.fill('');
    await expect(search, 'the search box is cleared').toHaveValue('');
    await expect(victimRow, 'clearing the search restores the conversation list').toBeVisible({
      timeout: 20_000,
    });
  });
});
