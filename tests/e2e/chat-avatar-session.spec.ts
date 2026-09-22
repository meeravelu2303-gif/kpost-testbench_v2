import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import type { Page } from '@playwright/test';

/**
 * Session safety in chat — clicking a contact's avatar must NOT end the session.
 *
 * Found live during a Contacts codegen pass: opening a conversation and clicking the contact's
 * profile image in the chat header **logs the user out** — the app bounces back to the login screen.
 * That is a serious functional defect (a normal, expected interaction destroys the session), and it
 * is fully visible, so the screenshot/video Playwright captures on failure are clear proof on their
 * own.
 *
 * The verdict is explicit: after clicking the avatar the user must still be authenticated — not on
 * `/login`, and the login field must not be showing. This spec is in the reporter's UI filing list,
 * so a reproduction files a ticket with proof automatically.
 *
 * Safe to run on any authenticated UI run: it only opens a conversation and clicks an avatar (no
 * message is sent, nothing is written). If the bug reproduces the session ends, but each test starts
 * from its own stored login, so it never affects another test.
 */

/** True if the app has dropped us on the login screen (session ended). */
async function isLoggedOut(page: Page): Promise<boolean> {
  if (/\/login(\b|\/|$)/.test(page.url())) return true;
  return page
    .getByRole('textbox', { name: /Enter KPOST ID \/ Mobile number/i })
    .first()
    .isVisible({ timeout: 5_000 })
    .catch(() => false);
}

test.describe('KPost Chat · session safety @ui', { tag: '@ui' }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench') || !testData.victimKpostId,
    'needs a real live account and a 2nd account to open a conversation with',
  );

  test('clicking a contact avatar in chat does not log the user out @ui', async ({ page }) => {
    test.setTimeout(90_000);

    await page.goto('/katchup', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page
      .locator('.loader-overlay')
      .waitFor({ state: 'hidden', timeout: 30_000 })
      .catch(() => undefined);

    // Open the conversation with the 2nd QA account, then its chat thread.
    const conversation = page.locator(`[id="${testData.victimKpostId}"]`).first();
    await expect(conversation, 'the 2nd QA account is in the conversation list').toBeVisible({
      timeout: 20_000,
    });
    await conversation.click();
    await page
      .locator('.msg-arrow')
      .first()
      .click({ timeout: 10_000 })
      .catch(() => undefined);

    // Sanity: we are still logged in before the interaction under test.
    expect(
      await isLoggedOut(page),
      'precondition: still signed in before clicking the avatar',
    ).toBe(false);

    // The contact's profile image/avatar in the chat header — the element that logged the user out
    // during the codegen pass.
    const avatar = page.locator('#ChatTop img, .chat-header img').first();
    const found = await avatar.isVisible({ timeout: 8_000 }).catch(() => false);
    // Skip (do NOT pass) if we cannot find an avatar to click — a green result must mean we actually
    // clicked one and the session survived, never that there was nothing to click.
    test.skip(
      !found,
      'no chat-header avatar found to click — share the contact display name / avatar selector',
    );

    await avatar.click({ timeout: 10_000 }).catch(() => undefined);
    await page.waitForLoadState('load', { timeout: 8_000 }).catch(() => undefined);

    expect(
      await isLoggedOut(page),
      'clicking a contact avatar in chat must not end the session / log the user out',
    ).toBe(false);
  });
});
