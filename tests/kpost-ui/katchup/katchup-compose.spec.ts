import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import type { Page } from '@playwright/test';
import { conversationRow } from '../support/katchup';

/**
 * Katchup composer: a Subject on every chat message (BR-K01), plus a gated send-and-recall.
 * A conversation row's element `id` is the counterpart's KPOST ID.
 */

/** The composer's editable Quill area; `.ql-editor` alone also matches sent-message displays. */
const EDITOR = '.ql-editor[contenteditable="true"]';

/** Open Katchup, wait out the loader overlay, open the 2nd QA account's conversation, open the composer. */
async function openComposer(page: Page): Promise<void> {
  await page.goto('/katchup', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  // A full-screen loader overlay intercepts clicks while the SPA loads — wait for it to disappear.
  await page
    .locator('.loader-overlay')
    .waitFor({ state: 'hidden', timeout: 30_000 })
    .catch(() => undefined);

  const conversation = conversationRow(page, testData.victimKpostId);
  await expect(conversation, 'the 2nd QA account is in the conversation list').toBeVisible({
    timeout: 20_000,
  });
  await conversation.click();
  await page.locator('.msg-arrow').first().click();
}

test.describe('KPost Katchup compose', { tag: ['@ui', '@katchup', '@regression'] }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench') || !testData.victimKpostId,
    'needs both QA accounts (QA_KPOST_ID, QA_VICTIM_KPOST_ID)',
  );

  test(
    'open a conversation, open the composer, and enter a Subject + message (BR-K01) @ui',
    { annotation: [{ type: 'requirement', description: 'BR-KU-SUBJECT' }] },
    async ({ page }) => {
      await openComposer(page);

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
    },
  );
});

/** Compose send: a real write gated behind KATCHUP_UI_LIFECYCLE; sends to the 2nd QA account, then recalls. */
test.describe(
  'KPost Katchup compose · send (write)',
  { tag: ['@ui', '@katchup', '@regression'] },
  () => {
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

      await expect(page.getByText(subject).first(), 'the sent message appears').toBeVisible({
        timeout: 20_000,
      });

      // Clean up: recall the message element that has our subject and its own action icon.
      const sentMessage = page
        .locator('[id]')
        .filter({ hasText: subject })
        .filter({ has: page.getByTestId('NotificationsNoneIcon') })
        .last();
      await sentMessage.hover();
      await sentMessage.getByTestId('NotificationsNoneIcon').first().click();
      const recall = page.getByRole('menuitem', { name: /Recall/i });
      await expect(recall, 'the message action menu offers Recall').toBeVisible({
        timeout: 15_000,
      });
      await recall.click();

      // The sender keeps a "recalled" marker, so check the menu closed; the recipient side is the
      // API Katchup lifecycle's job.
      await expect(recall, 'the recall action was accepted (menu closed)').toHaveCount(0, {
        timeout: 15_000,
      });
    });
  },
);
