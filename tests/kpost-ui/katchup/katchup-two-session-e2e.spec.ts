import { STORAGE_STATE_2 } from '@config/constants';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import type { Browser, Page } from '@playwright/test';
import {
  EDITOR,
  deleteSentMessage,
  gotoKatchup,
  messageBySubject,
  openComposer,
  openReceivedConversation,
  receivedMessageBySubject,
  sendMessage,
  submitComposer,
} from '../support/katchup';
import { signedIn } from '@fixtures/login-gate';

/**
 * Katchup between two accounts: delivery, realtime push and the recipient Reply/Comment/Clarify menu.
 * Account 2 is a second context from `.auth/user2.json`. Writes real messages (self-cleaning), so
 * gated behind KATCHUP_UI_LIFECYCLE=true.
 */

// Menu item names carry a leading space from their icon glyph (" Reply").
const RECIPIENT_ACTIONS: ReadonlyArray<{ id: string; menu: RegExp }> = [
  { id: 'Reply', menu: /Reply/i },
  { id: 'Comment', menu: /Comment/i },
  { id: 'Clarify', menu: /Clarify/i },
];

/** Send the composer's current message by pressing Enter (the app's native send trigger). */
async function clickSend(page: Page): Promise<void> {
  await submitComposer(page);
}

test.describe(
  'KPost Katchup · two-session (sender + receiver)',
  { tag: ['@ui', '@katchup', '@regression'] },
  () => {
    test.skip(
      process.env.KATCHUP_UI_LIFECYCLE !== 'true',
      'writes real messages between two accounts; set KATCHUP_UI_LIFECYCLE=true',
    );
    test.skip(
      !testData.kpostId ||
        testData.kpostId.includes('qa.bench') ||
        !testData.victimKpostId ||
        testData.victimKpostId.includes('qa.bench'),
      'needs both QA accounts (QA_KPOST_ID, QA_VICTIM_KPOST_ID)',
    );

    /** Open account 2's session in its own context. */
    async function openReceiver(browser: Browser): Promise<Page> {
      const context = await browser.newContext({ storageState: signedIn(STORAGE_STATE_2) });
      return context.newPage();
    }

    test('a message is delivered to the 2nd account and marks a read receipt (FR-K07) @ui', async ({
      page,
      browser,
    }) => {
      const subject = `QA UI 2s recv ${Date.now()}`;
      const receiver = await openReceiver(browser);
      try {
        // Account 1 → account 2.
        await openComposer(page);
        await sendMessage(page, subject, 'QA UI two-session delivery — self-cleaning');

        // Match the message, not a contact row: account 1 may be an unknown contact to account 2.
        await gotoKatchup(receiver);
        await expect(
          receiver.getByText(subject).first(),
          'account 2 receives the message account 1 sent',
        ).toBeVisible({ timeout: 25_000 });

        await expect(
          page.getByText(subject).first(),
          'account 1 still shows the sent message',
        ).toBeVisible({ timeout: 15_000 });
      } finally {
        await deleteSentMessage(page, subject).catch(() => undefined);
        await receiver.context().close();
      }
    });

    test(
      "a message from account 1 appears on account 2's OPEN Katchup with no refresh (realtime) @ui",
      {
        annotation: [{ type: 'requirement', description: 'RTM-KU-M01' }],
      },
      async ({ page, browser }) => {
        const subject = `QA UI realtime ${Date.now()}`;
        const receiver = await openReceiver(browser);
        try {
          // From here on nothing navigates or reloads account 2: this proves a live push to an open page.
          await gotoKatchup(receiver);
          await expect(
            receiver.getByText(subject),
            'the message is not on account 2 before account 1 sends it (baseline)',
          ).toHaveCount(0);

          // Account 1 sends while account 2's page stays open and untouched.
          await openComposer(page);
          await sendMessage(page, subject, 'QA UI realtime delivery — self-cleaning');

          await expect(
            receiver.getByText(subject).first(),
            'account 2 sees the new message on its already-open screen, no refresh (realtime push)',
          ).toBeVisible({ timeout: 30_000 });
        } finally {
          await deleteSentMessage(page, subject).catch(() => undefined);
          await receiver.context().close();
        }
      },
    );

    // Known defect #978: the Recents list has no unread badge at all, so there is nothing to test here.

    for (const action of RECIPIENT_ACTIONS) {
      test(
        `${action.id}: the 2nd account ${action.id.toLowerCase()}s a received message (recipient menu) @ui`,
        {
          annotation: [
            { type: 'requirement', description: 'FR-KU-043' },
            { type: 'requirement', description: 'FR-KU-044' },
            { type: 'requirement', description: 'FR-KU-045' },
          ],
        },
        async ({ page, browser }) => {
          const subject = `QA UI 2s ${action.id} ${Date.now()}`;
          const response = `QA UI ${action.id} response ${Date.now()}`;
          const receiver = await openReceiver(browser);
          try {
            // Account 1 sends.
            await openComposer(page);
            await sendMessage(page, subject, `QA UI ${action.id} source — self-cleaning`);

            // Account 2 opens the received conversation (by the unique subject) and acts on the message.
            await openReceivedConversation(receiver, subject);
            const received = receivedMessageBySubject(receiver, subject);
            await expect(received, `account 2 received the ${action.id} source`).toBeVisible({
              timeout: 25_000,
            });
            await received.hover();
            await received.getByTestId('ReplyIcon').first().click();

            const item = receiver.getByRole('menuitem', { name: action.menu });
            await expect(item, `the recipient menu offers ${action.id}`).toBeVisible({
              timeout: 15_000,
            });
            await item.click();

            // The composer opens in that mode; type the response and send.
            const editor = receiver.locator(EDITOR).first();
            await expect(editor, 'the recipient composer opens').toBeVisible({ timeout: 15_000 });
            await editor.click();
            await receiver.keyboard.type(response);
            await clickSend(receiver);

            await expect(
              receiver.getByText(response).first(),
              `the ${action.id} response appears`,
            ).toBeVisible({ timeout: 20_000 });
          } finally {
            // Account 2 deletes its response; account 1 deletes the source.
            if (await messageBySubject(receiver, response).count()) {
              await deleteSentMessage(receiver, response).catch(() => undefined);
            }
            await deleteSentMessage(page, subject).catch(() => undefined);
            await receiver.context().close();
          }
        },
      );
    }
  },
);
