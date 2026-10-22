import { STORAGE_STATE_2, TAGS } from '@config/constants';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { openSession } from '../journeys/support/journey';
import {
  deleteSentMessage,
  openComposerFor,
  openReceivedConversation,
  receivedMessageBySubject,
  sendMessage,
} from '../support/katchup';
import { requirePersonalAccount } from './smoke-ui';

/**
 * UI SMOKE · Katchup — the core of the product: qatest1 sends a message with a Subject and qatest2
 * receives it in their own signed-in browser. The sender deletes it afterwards (a sender's delete is
 * per participant, so qatest2's copy stays, as with any real chat).
 */
test.describe(
  'SMOKE · UI · Katchup',
  { tag: [TAGS.ui, TAGS.katchup, TAGS.smoke, TAGS.sanity, TAGS.regression] },
  () => {
    requirePersonalAccount();
    test.skip(!testData.victimKpostId, 'needs the second QA account (QA_VICTIM_KPOST_ID)');

    test('a message sent by one user is delivered to the other', async ({ page, browser }) => {
      test.setTimeout(150_000);
      const subject = `QA smoke katchup ${Date.now()}`;
      await openComposerFor(page, testData.victimKpostId);
      try {
        // sendMessage asserts the message appears in the sender's thread.
        await sendMessage(page, subject, 'QA smoke — safe to ignore');

        const b = await openSession(browser, STORAGE_STATE_2);
        try {
          await openReceivedConversation(b.page, subject);
          await expect(
            receivedMessageBySubject(b.page, subject),
            'the recipient sees the message in their own Katchup',
          ).toBeVisible({ timeout: 30_000 });
        } finally {
          await b.context.close();
        }
      } finally {
        await deleteSentMessage(page, subject).catch(() => undefined);
      }
    });
  },
);
