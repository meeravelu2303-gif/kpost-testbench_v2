import { STORAGE_STATE_2, TAGS } from '@config/constants';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import {
  deleteSentMessage,
  gotoKatchup,
  openComposerFor,
  openConversation,
  receivedMessageBySubject,
  sendMessage,
} from '../support/katchup';
import { openSession, requireAccounts, requireFlags, waitLoaded } from './support/journey';

/**
 * JOURNEY 2 · A CONVERSATION — two people talk in Katchup, in two real browsers.
 *
 * A writes to B with a Subject → B, sitting on Katchup, sees it arrive with no refresh → B's Home
 * shows it among the recent activity → B opens the thread and answers in it → A sees the answer in
 * the same thread, marked as received → both delete what they sent.
 *
 * UNPROVEN STEP (first live run): B's Home "Recents" panel — its selectors are built from source
 * (`HomePage.ts`, NEEDS-LIVE-TUNING) and no spec has asserted a new message there yet. The check is
 * the visible subject text on /home, the weakest selector that can be right.
 */
test.describe(
  'JOURNEY 2 · a conversation',
  {
    tag: [TAGS.ui, TAGS.journey, TAGS.katchup, TAGS.home, TAGS.regression],
    annotation: [{ type: 'requirement', description: 'RTM-KU-M01' }],
  },
  () => {
    test.describe.configure({ timeout: 240_000 });
    requireAccounts('A', 'B');
    requireFlags('KATCHUP_UI_LIFECYCLE');

    test('A writes, B receives live and answers in the thread, A sees the answer', async ({
      page,
      browser,
    }) => {
      const stamp = Date.now();
      const question = `QA journey ask ${stamp}`;
      const answer = `QA journey answer ${stamp}`;
      const b = await openSession(browser, STORAGE_STATE_2);
      let asked = false;
      let answered = false;

      try {
        await test.step('B is on Katchup before anything is sent', async () => {
          await gotoKatchup(b.page);
          await expect(b.page.getByText(question), 'nothing there yet (baseline)').toHaveCount(0);
        });

        await test.step('A writes to B with a Subject', async () => {
          await openComposerFor(page, testData.victimKpostId);
          await sendMessage(page, question, 'QA journey — a question for B');
          asked = true;
        });

        await test.step('B sees it arrive without refreshing', async () => {
          await expect(
            b.page.getByText(question).first(),
            "the message appears on B's open screen with no reload",
          ).toBeVisible({ timeout: 30_000 });
        });

        await test.step('B sees it on Home among the recent activity (UNPROVEN STEP)', async () => {
          await b.page.goto('/home', { waitUntil: 'domcontentloaded', timeout: 45_000 });
          await waitLoaded(b.page);
          await expect(
            b.page.getByText(question).first(),
            "the new message is listed in B's Home recents",
          ).toBeVisible({ timeout: 30_000 });
        });

        await test.step('B opens the thread and answers in it', async () => {
          await openConversation(b.page, testData.kpostId);
          await expect(
            receivedMessageBySubject(b.page, question),
            "A's message is in B's thread as a received message",
          ).toBeVisible({ timeout: 20_000 });
          await b.page.locator('.msg-arrow').first().click();
          await sendMessage(b.page, answer, 'QA journey — B answers A');
          answered = true;
        });

        await test.step('A sees the answer in the same thread', async () => {
          await openConversation(page, testData.victimKpostId);
          await expect(
            receivedMessageBySubject(page, answer),
            "B's answer is in A's thread as a received message",
          ).toBeVisible({ timeout: 30_000 });
          await expect(
            page.getByText(question).first(),
            "A's own question is still there, above the answer",
          ).toBeVisible();
        });
      } finally {
        if (answered)
          await openConversation(b.page, testData.kpostId)
            .then(() => deleteSentMessage(b.page, answer))
            .catch(() => undefined);
        if (asked)
          await openConversation(page, testData.victimKpostId)
            .then(() => deleteSentMessage(page, question))
            .catch(() => undefined);
        await b.context.close();
      }
    });
  },
);
