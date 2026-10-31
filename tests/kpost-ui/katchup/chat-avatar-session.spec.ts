import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import type { Page } from '@playwright/test';
import { retryOrSkip } from '../../support/live-condition';
import { conversationRow } from '../support/katchup';

/**
 * Katchup chat header: clicking the contact's avatar must not log the user out. Read-only; each test
 * starts from its own stored login, so a lost session never affects another test.
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

test.describe(
  'KPost Chat · session safety @ui',
  { tag: ['@ui', '@katchup', '@regression'] },
  () => {
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
      const conversation = conversationRow(page, testData.victimKpostId);
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

      // The header avatar is rendered by react-avatar (`.sb-avatar`, initials or img).
      const avatar = page.locator('#ChatTop .sb-avatar, #ChatTop img, .chat-header img').first();
      const found = await avatar.isVisible({ timeout: 8_000 }).catch(() => false);
      // Skip rather than pass when there is nothing to click.
      retryOrSkip(
        !found,
        'no chat-header avatar rendered right now (header still loading) — nothing to click',
      );

      await avatar.click({ timeout: 10_000 }).catch(() => undefined);
      await page.waitForLoadState('load', { timeout: 8_000 }).catch(() => undefined);

      expect(
        await isLoggedOut(page),
        'clicking a contact avatar in chat must not end the session / log the user out',
      ).toBe(false);
    });
  },
);
