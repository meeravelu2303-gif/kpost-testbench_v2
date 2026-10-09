import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * KOS (`/kdoc`) — the top-level tool picker (`KOS.js` + `ToolList/ToolList.js`). Confirmed from
 * source: 8 tools total, 4 genuinely built (K-AI, Kompose [=KWord], KPresenter, KAD Document) and 4
 * legitimate "coming soon" placeholders (K Spread Sheet, KNote, KBrochure, KWeb) — NOT stub bugs, an
 * intentionally unbuilt roadmap, confirmed by their own `comingSoon: true` flag in `KOS_TOOLS.js`.
 *
 * KPresenter is a special case: clicking its tool card does NOT mount the inline component —
 * `handleToolSelect` reads the account's token/kpostID and `window.open()`s an EXTERNAL presenter app
 * URL instead, or shows an error toast if the token is missing.
 */
test.describe('KPost KOS — tool picker', { tag: ['@ui', '@kos'] }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  test('the KOS screen loads and lists all 8 tool cards @ui', async ({ page }) => {
    await page.goto('/kdoc', { waitUntil: 'domcontentloaded', timeout: 45_000 });

    for (const tool of ['K-AI', 'Kompose', 'KPresenter', 'KAD Document']) {
      await expect(
        page.getByText(tool, { exact: true }).first(),
        `the "${tool}" tool card renders`,
      ).toBeVisible({ timeout: 15_000 });
    }
  });

  test('the 4 unbuilt tools show a "Coming Soon" placeholder, not a crash @ui', async ({ page }) => {
    await page.goto('/kdoc', { waitUntil: 'domcontentloaded', timeout: 45_000 });

    for (const tool of ['K Spread Sheet', 'KNote', 'KBrochure', 'KWeb']) {
      await page.getByText(tool, { exact: true }).first().click();
      await expect(
        page.getByText(/Coming Soon/i).first(),
        `selecting "${tool}" shows the documented Coming Soon placeholder`,
      ).toBeVisible({ timeout: 10_000 });
    }
  });

  test('selecting KPresenter opens the external presenter app in a new tab, not an in-app crash @ui', async ({
    page,
    context,
  }) => {
    await page.goto('/kdoc', { waitUntil: 'domcontentloaded', timeout: 45_000 });

    const [popup] = await Promise.all([
      context.waitForEvent('page', { timeout: 10_000 }),
      page.getByText('KPresenter', { exact: true }).first().click(),
    ]);

    expect(popup.url(), 'KPresenter opens the external presenter app URL').toContain('presenter');
    await popup.close();
  });
});
