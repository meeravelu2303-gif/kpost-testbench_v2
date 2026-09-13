import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * The Katchup **screen** on the live front end.
 *
 * Runs only with a real logged-in session (the `setup` project saved one). The module lives behind
 * login and has **no `data-testid` hooks**, so locators are by role/text and are necessarily more
 * brittle than an id — the reason test-ids are a standing ask for the UI bench.
 *
 * The compose/send flow writes a real message, so it is gated behind `KATCHUP_LIFECYCLE=true` exactly
 * like the API lifecycle test (owner sign-off, `docs/katchup-flow.md` §6). Without the flag this file
 * only asserts the screen loads for an authenticated user — a real smoke check that catches an outage
 * or a broken auth redirect.
 */
test.describe('KPost Katchup screen', { tag: '@ui' }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  test('the Katchup screen loads for a logged-in user @ui', async ({ page }) => {
    await page.goto('/katchup');
    // A logged-out session would be bounced to /login; staying on /katchup proves the session works.
    await expect(page, 'an authenticated user reaches Katchup').toHaveURL(/\/katchup/);
  });

  test('compose carries a Subject field — the module differentiator (BR-K01) @ui', async ({
    page,
  }) => {
    test.skip(
      process.env.KATCHUP_LIFECYCLE !== 'true',
      'opening a conversation and composing is a write path; set KATCHUP_LIFECYCLE=true',
    );
    await page.goto('/katchup');

    /*
     * Open a conversation with our second account, then assert the composer shows a Subject input —
     * the field no mainstream chat product has (BR-K01). Best-effort selectors from WriteMessage.js
     * (placeholder "Subject"); if the markup changes, this points here.
     */
    await page.getByText(testData.victimKpostId, { exact: false }).first().click();
    await expect(
      page.getByPlaceholder(/subject/i).first(),
      'the composer offers a Subject field',
    ).toBeVisible();
  });
});
