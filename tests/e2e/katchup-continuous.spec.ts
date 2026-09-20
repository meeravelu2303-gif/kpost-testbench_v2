import { env } from '@config/env';
/* eslint-disable playwright/no-conditional-in-test */
/* eslint-disable playwright/no-wait-for-timeout -- the pause BETWEEN sends is the whole point: the
   reported bug is that a second message will not send until you refresh, and it appears only after a
   real gap. The fixed wait reproduces that gap on purpose. */
import { testData } from '@config/test-data.config';
import { failedUserActions, healthFailures, isResponsive, watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';
import { deleteSentMessage, gotoKatchup, openConversation, sendMessage } from './support/katchup';
import { skipIfSignedOut } from './support/session';

/**
 * Continuous messaging — the owner's reported defect: after sending one message you cannot send
 * another (to the same or a second person) without refreshing the page. This reproduces that flow
 * directly: it opens a conversation and sends SEVERAL messages in ONE session, with a real gap
 * between them and NO reload, asserting every send goes through.
 *
 * Two independent signals catch the bug, so it is not selector-fragile:
 *   - the message actually appears (`sendMessage` waits for it) — a broken 2nd send times out, and
 *   - no send API call failed (`failedUserActions`) and the page did not crash or freeze.
 *
 * Gated behind `KATCHUP_UI_LIFECYCLE=true` (it writes real messages, then self-cleans), so it runs
 * under `npm run ui` but never on a default run. Runs on all three browsers, so a browser-specific
 * "must refresh to send again" is caught and the ticket names the browser.
 */
test.describe(
  'KPost Katchup · continuous send (no refresh between messages)',
  { tag: '@ui' },
  () => {
    test.skip(
      !env.KATCHUP_UI_LIFECYCLE,
      'writes real messages; set KATCHUP_UI_LIFECYCLE=true (npm run ui does)',
    );
    test.skip(
      !testData.victimKpostId || testData.victimKpostId.includes('qa.bench'),
      'needs the second QA account (QA_VICTIM_KPOST_ID)',
    );

    test('sends five messages in one session without a refresh @ui', async ({ page }) => {
      await skipIfSignedOut(page);
      const stop = watchUiHealth(page);

      await gotoKatchup(page);
      await openConversation(page, testData.victimKpostId);

      const stamp = Date.now();
      const subjects: string[] = [];
      const failed: number[] = [];
      // Five sends, with a gap between each — the interval where the "need to refresh" bug appears.
      for (let i = 1; i <= 5; i += 1) {
        const subject = `QA continuous ${stamp}-${i}`;
        try {
          await sendMessage(page, subject, `Continuous-send check, message ${i} of 5.`);
          subjects.push(subject);
        } catch {
          failed.push(i); // this send did not go through without a refresh — the reported defect
          break;
        }
        await page.waitForTimeout(2000); // a real pause between messages
      }

      const responsive = await isResponsive(page);
      const health = stop();

      // Self-clean every message that did send, so the QA account is unchanged.
      for (const subject of subjects) await deleteSentMessage(page, subject).catch(() => undefined);

      const problems = [
        ...(failed.length
          ? [`send #${failed[0]} did NOT go through without refreshing the page`]
          : []),
        ...failedUserActions(health).map((c) => `send API call failed: ${c.status} ${c.url}`),
        ...healthFailures(health),
        ...(responsive ? [] : ['the screen FROZE after sending']),
      ];
      expect(
        problems,
        `continuous messaging broke — ${problems.join(' | ')} (sent ${subjects.length}/5)`,
      ).toEqual([]);
    });
  },
);
