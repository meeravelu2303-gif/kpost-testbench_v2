import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import type { Locator, Page } from '@playwright/test';
import {
  EDITOR,
  messageBySubject,
  openBellMenu,
  openComposer,
  sendMessage,
  submitComposer,
} from '../support/katchup';

/**
 * Katchup recall → Edit & Repost → recall again → Delete on a sent message. The 2nd QA account never
 * opens it, so it stays unread and recallable. Gated behind KATCHUP_UI_LIFECYCLE; deletes what it made.
 */
test.describe(
  'KPost Katchup · recall, edit & repost, delete (FR-KU-029..031)',
  { tag: ['@ui', '@katchup', '@regression'] },
  () => {
    test.describe.configure({ timeout: 150_000 });
    test.skip(
      process.env.KATCHUP_UI_LIFECYCLE !== 'true',
      'writes real messages; set KATCHUP_UI_LIFECYCLE=true',
    );
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench') || !testData.victimKpostId,
      'needs both QA accounts (QA_KPOST_ID, QA_VICTIM_KPOST_ID)',
    );

    async function recall(page: Page, message: Locator, what: string): Promise<void> {
      await openBellMenu(page, message);
      const items = page.getByRole('menuitem');
      await expect(items.first(), 'the bell menu opens').toBeVisible({ timeout: 15_000 });
      const offered = (await items.allInnerTexts()).map((t) => t.trim()).filter(Boolean);
      const item = items.filter({ hasText: /^\s*Recall\s*$/i }).first();
      await expect(
        item,
        `the bell menu offers Recall on ${what} (offered: ${offered.join(' | ')})`,
      ).toBeVisible({ timeout: 10_000 });
      await item.click();
      await expect(item, 'Recall was accepted (menu closed)').toHaveCount(0, { timeout: 15_000 });
    }

    test(
      'a recalled message offers only Edit & Repost / Delete; Edit & Repost reposts it; the repost can be recalled again; Delete removes it with a confirmation @ui',
      {
        annotation: [
          { type: 'requirement', description: 'FR-KU-028' },
          { type: 'requirement', description: 'FR-KU-029' },
          { type: 'requirement', description: 'FR-KU-030' },
          { type: 'requirement', description: 'FR-KU-031' },
        ],
      },
      async ({ page }) => {
        const subject = `QA UI Recall ${Date.now()}`;
        await openComposer(page);
        const original = await sendMessage(page, subject, 'QA UI recall-repost — original body');

        // --- Recall (pre-condition of FR-KU-029).
        await recall(page, original, 'an unread sent message');
        const recalled = messageBySubject(page, subject);
        await expect(recalled, 'the sender keeps the message, marked Recalled').toContainText(
          /Recalled/i,
          { timeout: 15_000 },
        );

        // --- FR-KU-029 step 1: the post-recall menu is reduced to Edit & Repost and Delete.
        await openBellMenu(page, recalled);
        const menu = page.getByRole('menuitem');
        await expect(
          menu.filter({ hasText: /Edit & Repost/i }),
          'offers Edit & Repost',
        ).toBeVisible({
          timeout: 15_000,
        });
        await expect(menu.filter({ hasText: /^\s*Delete\s*$/i }), 'offers Delete').toBeVisible();
        const names = (await menu.allInnerTexts()).map((t) => t.trim()).filter(Boolean);
        expect(
          names.filter((n) => !/Edit & Repost|^Delete$/i.test(n)),
          `the post-recall menu offers nothing else (saw: ${names.join(' | ')})`,
        ).toEqual([]);

        // --- FR-KU-029 steps 2–4: Edit & Repost opens the composer with the body, edit it, repost.
        await menu.filter({ hasText: /Edit & Repost/i }).click();
        const editor = page.locator(EDITOR).first();
        await expect(editor, 'the Edit & Repost sheet opens with an editable body').toBeVisible({
          timeout: 15_000,
        });
        await expect(editor, 'the recalled body is pre-filled').toContainText('original body', {
          timeout: 10_000,
        });
        await editor.click();
        await page.keyboard.press('End');
        await page.keyboard.type(' — reposted');
        await submitComposer(page);
        const reposted = page
          .locator('[id]')
          .filter({ hasText: 'original body — reposted' })
          .filter({ has: page.getByTestId('NotificationsNoneIcon') })
          .last();
        await expect(reposted, 'the reposted message appears in the thread').toBeVisible({
          timeout: 20_000,
        });

        // --- FR-KU-030: Recall is available again on the reposted (unread) message.
        await recall(page, reposted, 'the reposted, still-unread message (FR-KU-030)');
        await expect(reposted, 'the repost is retracted the same way').toContainText(/Recalled/i, {
          timeout: 15_000,
        });

        // --- FR-KU-031: Delete the recalled message through the confirmation dialog.
        await openBellMenu(page, reposted);
        await page.getByRole('menuitem', { name: /Delete/i }).click();
        const confirm = page.getByRole('dialog').filter({ hasText: /Delete Message/i });
        await expect(confirm, 'the Delete Message confirmation opens').toBeVisible({
          timeout: 10_000,
        });
        await expect(confirm, 'it asks for confirmation').toContainText(/Do you want to Delete/i);
        await confirm.getByRole('button', { name: /^Confirm$/i }).click();
        await expect(reposted, 'the message is removed from the thread').toBeHidden({
          timeout: 15_000,
        });

        // Self-clean the first (recalled) message too, so the account ends as it started.
        if (await messageBySubject(page, subject).count()) {
          await openBellMenu(page, messageBySubject(page, subject));
          await page.getByRole('menuitem', { name: /Delete/i }).click();
          await page
            .getByRole('dialog')
            .filter({ hasText: /Delete Message/i })
            .getByRole('button', { name: /^Confirm$/i })
            .click()
            .catch(() => undefined);
        }
      },
    );
  },
);
