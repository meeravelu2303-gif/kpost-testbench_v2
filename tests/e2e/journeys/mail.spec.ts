import { STORAGE_STATE_2, TAGS } from '@config/constants';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import {
  deleteOpenMail,
  openMail,
  openSession,
  replyToOpenMail,
  requireAccounts,
  requireFlags,
  sendMailFromUi,
} from './support/journey';

/**
 * JOURNEY 3 · A MAIL EXCHANGE — A and B correspond through KMail, in two real browsers.
 *
 * A composes a mail to B → B finds it in KMail, opens it and reads exactly what A wrote → B replies →
 * the reply is addressed back to A and points at the original → A opens the thread and reads B's
 * actual reply text → both delete the mail from their own side, in the UI.
 *
 * Known open bugs this journey runs into, by design (it asserts the correct behaviour):
 * #1348 — the opened mail can come back with an empty body; #1359 — opening is not always marked read.
 *
 * UNPROVEN STEP (first live run): deleting from the SENDER's side. The UI delete (ReplyIcon → More →
 * Delete) is proven for the receiver's copy (`kmail-features-e2e.spec.ts`); A's copy uses the same
 * menu but has not been recorded. Clean-up is best-effort and never fails the journey.
 */
test.describe(
  'JOURNEY 3 · a mail exchange',
  {
    tag: [TAGS.ui, TAGS.journey, TAGS.kmail, TAGS.regression],
    annotation: [
      { type: 'requirement', description: 'FR-KM-012' },
      { type: 'requirement', description: 'FR-KM-018' },
      { type: 'requirement', description: 'RTM-KMAIL-F01' },
      { type: 'requirement', description: 'RTM-KMAIL-F07' },
    ],
  },
  () => {
    test.describe.configure({ timeout: 240_000 });
    requireAccounts('A', 'B');
    requireFlags('KMAIL_UI_LIFECYCLE', 'KATCHUP_UI_LIFECYCLE');

    test('A mails B, B reads it and replies, A reads the reply, both clean up', async ({
      page,
      browser,
    }) => {
      const stamp = Date.now();
      const subject = `QA journey mail ${stamp}`;
      const body = `QA journey mail body ${stamp}`;
      const replyText = `QA journey reply ${stamp}`;
      const b = await openSession(browser, STORAGE_STATE_2);
      let sent = false;

      try {
        await test.step('A composes and sends the mail', async () => {
          const request = await sendMailFromUi(page, testData.victimKpostId, subject, body);
          sent = true;
          expect(JSON.stringify(request.toAddress ?? ''), 'addressed to B').toContain(
            testData.victimKpostId,
          );
        });

        await test.step('B finds the mail, opens it and reads exactly what A wrote', async () => {
          await openMail(b.page, subject);
          await expect(
            b.page.getByText(body, { exact: false }).first(),
            'B reads the exact body on first open (#1348 if empty)',
          ).toBeVisible({ timeout: 20_000 });
        });

        await test.step('B replies; the reply goes back to A and points at the original', async () => {
          const reply = await replyToOpenMail(b.page, replyText);
          expect(reply.toAddress, 'the reply is addressed to A').toBe(testData.kpostId);
          expect(
            (reply.referenceKmailID as unknown[] | undefined)?.length ?? 0,
            'the reply references the original mail',
          ).toBeGreaterThan(0);
        });

        await test.step("A opens the thread and reads B's reply", async () => {
          await openMail(page, subject);
          await expect(
            page.getByText(replyText, { exact: false }).first(),
            "A reads B's actual reply text in the thread",
          ).toBeVisible({ timeout: 30_000 });
        });
      } finally {
        if (sent) {
          await openMail(b.page, subject)
            .then(() => deleteOpenMail(b.page))
            .catch(() => false);
          await openMail(page, subject)
            .then(() => deleteOpenMail(page))
            .catch(() => false);
        }
        await b.context.close();
      }
    });
  },
);
