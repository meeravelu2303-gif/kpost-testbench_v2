import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import {
  deleteSentMessage,
  messageBySubject,
  openBellMenu,
  openComposer,
  openConversation,
  sendMessage,
} from '../support/katchup';

/**
 * Katchup bell-menu sub-flow entries (Note, Reminder, Transfer, Forward): the item opens its next
 * surface. Completion is tested in the *-subflow-e2e specs. Gated behind KATCHUP_UI_LIFECYCLE; self-cleaning.
 */

// `req`: the FRD requirement whose entry this proves (completion is asserted elsewhere, if at all).
const SUBFLOW_ACTIONS: ReadonlyArray<{ id: string; menu: RegExp; req?: string }> = [
  { id: 'Note', menu: /Note/i, req: 'FR-KU-032' },
  { id: 'Reminder', menu: /Reminder/i, req: 'FR-KU-033' },
  { id: 'Transfer', menu: /Transfer/i, req: 'FR-KU-034' },
  // End-anchored so it skips "Forward With Thread", whose item has no matchable accessible name.
  { id: 'Forward', menu: /Forward\s*$/i },
];

test.describe(
  'KPost Katchup · sender sub-flow actions (write)',
  { tag: ['@ui', '@katchup', '@regression'] },
  () => {
    test.skip(
      process.env.KATCHUP_UI_LIFECYCLE !== 'true',
      'writes real messages; set KATCHUP_UI_LIFECYCLE=true',
    );
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench') || !testData.victimKpostId,
      'needs both QA accounts (QA_KPOST_ID, QA_VICTIM_KPOST_ID)',
    );

    for (const action of SUBFLOW_ACTIONS) {
      test(
        `${action.id} opens from the bell menu (entry wired), then self-cleans @ui`,
        {
          annotation: [
            { type: 'requirement-partial', description: 'FR-KU-025' },
            ...(action.req ? [{ type: 'requirement-partial', description: action.req }] : []),
          ],
        },
        async ({ page }) => {
          const subject = `QA UI ${action.id.replace(/\W+/g, '')} ${Date.now()}`;
          await openComposer(page);
          const message = await sendMessage(page, subject, `QA UI ${action.id} — self-cleaning`);

          // A dismissed menu item means the action was accepted and its next surface took over.
          await openBellMenu(page, message);
          const item = page.getByRole('menuitem', { name: action.menu });
          await expect(item, `the bell menu offers ${action.id}`).toBeVisible({ timeout: 15_000 });
          await item.click();
          await expect(item, `${action.id} was accepted (menu item dismissed)`).toBeHidden({
            timeout: 15_000,
          });

          // Escape does not always close the picker modal, so reopen the conversation to unmount it
          // before the cleanup needs the bell menu.
          await page.keyboard.press('Escape').catch(() => undefined);
          await openConversation(page, testData.victimKpostId).catch(() => undefined);

          if (await messageBySubject(page, subject).count()) {
            await deleteSentMessage(page, subject);
          }
        },
      );
    }
  },
);
