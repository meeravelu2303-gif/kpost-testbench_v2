import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import type { Page } from '@playwright/test';

/**
 * Katchup **compose** flow — the deepest, most valuable UI interaction: it drives the composer like a
 * user and proves KPost's reason-to-exist differentiator on screen — **a Subject on every chat
 * message (BR-K01)**, which no mainstream chat product has.
 *
 * Selectors are the real ones recorded from the live app. Two things live tuning taught:
 *  - a conversation row carries the counterpart's KPOST ID as its element `id`;
 *  - `.ql-editor` matches BOTH sent-message displays (`contenteditable="false"`) and the composer, so
 *    the composer is targeted by `contenteditable="true"`;
 *  - a full-screen `.loader-overlay` intercepts clicks while the SPA loads, so we wait for it to clear.
 */

/** The composer's editable Quill area (not a read-only sent-message display). */
const EDITOR = '.ql-editor[contenteditable="true"]';

/** Open Katchup, wait out the loader overlay, open the 2nd QA account's conversation, open the composer. */
async function openComposer(page: Page): Promise<void> {
  await page.goto('/katchup', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  // A full-screen loader overlay intercepts clicks while the SPA loads — wait for it to disappear.
  await page
    .locator('.loader-overlay')
    .waitFor({ state: 'hidden', timeout: 30_000 })
    .catch(() => undefined);

  const conversation = page.locator(`[id="${testData.victimKpostId}"]`).first();
  await expect(conversation, 'the 2nd QA account is in the conversation list').toBeVisible({
    timeout: 20_000,
  });
  await conversation.click();
  await page.locator('.msg-arrow').first().click();
}

test.describe('KPost Katchup compose', { tag: '@ui' }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench') || !testData.victimKpostId,
    'needs both QA accounts (QA_KPOST_ID, QA_VICTIM_KPOST_ID)',
  );

  test('open a conversation, open the composer, and enter a Subject + message (BR-K01) @ui', async ({
    page,
  }) => {
    await openComposer(page);

    // The Subject field — BR-K01, the product differentiator: a subject on every chat message.
    const subject = page.getByRole('textbox', { name: 'Subject' });
    await expect(subject, 'a chat message carries a Subject field (BR-K01)').toBeVisible({
      timeout: 15_000,
    });
    await subject.click();
    await subject.fill('QA subject');
    await expect(subject, 'the Subject field accepts text').toHaveValue('QA subject');

    // The message body is a contenteditable Quill DIV, so type into it (not `.fill()`). No send.
    const messageBody = page.locator(EDITOR).first();
    await messageBody.click();
    await page.keyboard.type('QA test message');
    await expect(messageBody, 'the message body accepts text').toContainText('QA test message');
  });
});

/**
 * Katchup compose **SEND** — a real write, so it is gated (`KATCHUP_UI_LIFECYCLE=true`) and
 * self-cleaning: it sends a uniquely-subjected message to our OWN 2nd QA account, verifies it appears,
 * then **recalls** it, so the accounts end exactly as they started (send = the icon button in
 * `#ChatTop`; recall = the message action menu → "Recall").
 */
test.describe('KPost Katchup compose · send (write)', { tag: '@ui' }, () => {
  test.skip(
    process.env.KATCHUP_UI_LIFECYCLE !== 'true',
    'sends a real message; set KATCHUP_UI_LIFECYCLE=true',
  );
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench') || !testData.victimKpostId,
    'needs both QA accounts',
  );

  test('send a Subject-bearing message to the 2nd QA account, verify it appears, then recall it @ui', async ({
    page,
  }) => {
    // A unique subject so verification and recall target THIS message, not an older one.
    const subject = `QA UI ${Date.now()}`;
    const body = 'QA UI test message — self-cleaning';

    await openComposer(page);

    await page.getByRole('textbox', { name: 'Subject' }).fill(subject);
    await page.locator(EDITOR).first().click();
    await page.keyboard.type(body);

    // Send.
    await page.locator('#ChatTop').getByRole('button').filter({ hasText: /^$/ }).first().click();

    // The sent message appears in the conversation, carrying its Subject (BR-K01, on live).
    await expect(page.getByText(subject).first(), 'the sent message appears').toBeVisible({
      timeout: 20_000,
    });

    // Clean up: recall OUR message. Each message is a DOM element whose id is its msgID and which
    // carries its own action icon — so find the message that has our unique subject AND an action
    // icon, and recall that one (recall = unsend; the recipient never sees it — FR-K10/BR-K03).
    const sentMessage = page
      .locator('[id]')
      .filter({ hasText: subject })
      .filter({ has: page.getByTestId('NotificationsNoneIcon') })
      .last();
    await sentMessage.hover();
    await sentMessage.getByTestId('NotificationsNoneIcon').first().click();
    const recall = page.getByRole('menuitem', { name: /Recall/i });
    await expect(recall, 'the message action menu offers Recall').toBeVisible({ timeout: 15_000 });
    await recall.click();

    // Recall UNSENDS the message (the recipient never sees it — FR-K10/BR-K03); the sender keeps a
    // "recalled" marker, so we confirm the action was ACCEPTED (the menu closed), not that the text
    // vanished from our own view. The recipient-side effect is covered by the API Katchup lifecycle.
    await expect(recall, 'the recall action was accepted (menu closed)').toHaveCount(0, {
      timeout: 15_000,
    });
  });
});
