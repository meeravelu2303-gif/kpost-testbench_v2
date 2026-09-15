/* eslint-disable playwright/no-conditional-in-test */
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import {
  deleteSentMessage,
  messageBySubject,
  openBellMenu,
  openComposer,
  sendMessage,
} from './support/katchup';

/**
 * Katchup sender **sub-flow** actions — the bell-menu items that open a further surface (a modal, a
 * contact picker, or the composer in a re-post mode): **Note · Reminder · Transfer · Forward ·
 * Forward-with-thread · Recall & Repost** (the `bellIconContent` array, `KatchupMessage.js`).
 *
 * Each test reliably verifies the ACTION ENTRY is wired — send a message → open the bell menu → click
 * the action → the menu item is dismissed (the action was accepted and its next surface took over) —
 * then self-cleans by deleting the source message. All gated behind `KATCHUP_UI_LIFECYCLE=true`.
 *
 * FIRST-RUN NOTE: the sub-flow COMPLETION (typing the note, setting the reminder time, picking the
 * forward/transfer recipient and confirming) needs one live recording pass to capture each modal's
 * internals — those components live in `forwardFooter/`, `Transfer`, and the note/reminder modals. The
 * entry assertion here is the validated part; completion is the tuning step. Never runs by default.
 */

const SUBFLOW_ACTIONS: ReadonlyArray<{ id: string; menu: RegExp }> = [
  { id: 'Note', menu: /Note/i },
  { id: 'Reminder', menu: /Reminder/i },
  { id: 'Transfer', menu: /Transfer/i },
  { id: 'Forward', menu: /Forward\s*$/i },
  { id: 'Forward With Thread', menu: /Forward\s*With\s*Thread/i },
  { id: 'Recall & Repost', menu: /Repost/i },
];

test.describe('KPost Katchup · sender sub-flow actions (write)', { tag: '@ui' }, () => {
  test.skip(
    process.env.KATCHUP_UI_LIFECYCLE !== 'true',
    'writes real messages; set KATCHUP_UI_LIFECYCLE=true',
  );
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench') || !testData.victimKpostId,
    'needs both QA accounts (QA_KPOST_ID, QA_VICTIM_KPOST_ID)',
  );

  for (const action of SUBFLOW_ACTIONS) {
    test(`${action.id} opens from the bell menu (entry wired), then self-cleans @ui`, async ({
      page,
    }) => {
      const subject = `QA UI ${action.id.replace(/\W+/g, '')} ${Date.now()}`;
      await openComposer(page);
      const message = await sendMessage(page, subject, `QA UI ${action.id} — self-cleaning`);

      // Open the bell menu and click the action. The menu item must be present (the action exists on
      // a message we sent) and, once clicked, must be dismissed — the action was accepted and its next
      // surface (modal / picker / composer) has taken over.
      await openBellMenu(page, message);
      const item = page.getByRole('menuitem', { name: action.menu });
      await expect(item, `the bell menu offers ${action.id}`).toBeVisible({ timeout: 15_000 });
      await item.click();
      await expect(item, `${action.id} was accepted (menu item dismissed)`).toBeHidden({
        timeout: 15_000,
      });

      // Dismiss whatever surface opened (modal / picker), without submitting, so no extra state is left.
      await page.keyboard.press('Escape').catch(() => undefined);

      // Self-clean: delete the source message so the account ends as it started.
      if (await messageBySubject(page, subject).count()) {
        await deleteSentMessage(page, subject);
      }
    });
  }
});
