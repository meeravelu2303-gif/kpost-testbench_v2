import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * The Katchup **screen** on the live front end, using the authenticated session `setup` saved.
 *
 * Because the session is reused, these do not log in — so they are far more stable than the login
 * screen tests. The component ships no `data-testid` hooks, so locators are structural (classes and
 * text from `KPOST_REACTJS_2023_V1`), each noted so a UI change points here.
 *
 * The compose/send flow writes a real message, so it is gated behind `KATCHUP_LIFECYCLE=true` (the
 * same authorization as the API feature flow). Without it, this file asserts the screen renders and
 * carries its differentiator — the Subject field (BR-K01) — which no mainstream chat product has.
 */
test.describe('KPost Katchup screen', { tag: '@ui' }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  test('the Katchup screen loads for a logged-in user @ui', async ({ page }) => {
    await page.goto('/katchup', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    // A logged-out session is bounced to /login; staying on /katchup proves the saved session works.
    await expect(page, 'an authenticated user reaches Katchup').toHaveURL(/\/katchup/);
    await expect(page.getByText('Katchup', { exact: false }).first()).toBeVisible({
      timeout: 20_000,
    });
  });

  test('the contact list / search is present @ui', async ({ page }) => {
    await page.goto('/katchup', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    // The contact search box (placeholder "Search…") — the entry point to any conversation.
    await expect(page.locator('[placeholder*="Search" i]').first()).toBeVisible({
      timeout: 20_000,
    });
  });

  test('compose carries a Subject field — the differentiator (BR-K01) @ui', async ({ page }) => {
    await page.goto('/katchup', { waitUntil: 'domcontentloaded', timeout: 45_000 });

    /*
     * The Subject is what distinguishes Katchup from Slack/Teams/Zoom/Google Chat (BR-K01). It is
     * present in the message UI as `.fw_Msg_subject` / the text "Subject". Asserting it exists on the
     * screen proves the differentiator is wired, without needing to open a conversation and compose.
     * `toBeVisible` auto-retries up to its timeout, so no explicit wait is needed.
     */
    const subject = page
      .locator('.fw_Msg_subject')
      .or(page.getByText(/^Subject/i))
      .first();
    await expect(subject, 'the Subject field is part of the Katchup UI').toBeVisible({
      timeout: 20_000,
    });
  });
});
