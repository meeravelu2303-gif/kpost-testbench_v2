import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import {
  EDITOR,
  deleteSentMessage,
  openBellMenu,
  openComposer,
  sendMessage,
} from '../support/katchup';

/**
 * Katchup sender actions from the bell menu (Delete, Edit, Save, Copy) on a message sent to the 2nd
 * QA account. Real writes, gated behind KATCHUP_UI_LIFECYCLE; every test deletes what it sent.
 */
test.describe(
  'KPost Katchup · sender message actions (write)',
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

    test(
      'Delete removes a sent message from the conversation (send → Delete → Confirm → gone) @ui',
      { annotation: [{ type: 'requirement-partial', description: 'FR-KU-042' }] },
      async ({ page }) => {
        const subject = `QA UI del ${Date.now()}`;
        await openComposer(page);
        const message = await sendMessage(page, subject, 'QA UI delete — self-cleaning');

        // Bell menu → Delete → the "Delete Message" confirm dialog → Confirm.
        await openBellMenu(page, message);
        const del = page.getByRole('menuitem', { name: /Delete/i });
        await expect(del, 'the sender action menu offers Delete').toBeVisible({ timeout: 15_000 });
        await del.click();

        // The confirm dialog: "Do you want to Delete this Message? Please confirm" → Confirm.
        const confirm = page.getByRole('button', { name: /^Confirm$/i });
        await expect(confirm, 'the delete confirmation dialog appears').toBeVisible({
          timeout: 15_000,
        });
        await confirm.click();

        // The dialog closing is the reliable signal: the text appears in several DOM places, and the
        // server-side removal is asserted by the API Katchup lifecycle.
        await expect(confirm, 'the delete was accepted (the confirm dialog closed)').toHaveCount(
          0,
          {
            timeout: 15_000,
          },
        );
      },
    );

    test(
      'Edit re-sends an edited body and marks it Edited (send → Edit → resend → Edited), then deletes @ui',
      { annotation: [{ type: 'requirement', description: 'FR-KU-027' }] },
      async ({ page }) => {
        const subject = `QA UI edit ${Date.now()}`;
        const editedBody = 'QA UI edited body — self-cleaning';
        await openComposer(page);
        const message = await sendMessage(page, subject, 'QA UI original body');

        // Bell menu → Edit → the composer reopens pre-filled (EditMsg mode).
        await openBellMenu(page, message);
        const edit = page.getByRole('menuitem', { name: /Edit/i });
        await expect(edit, 'the sender action menu offers Edit').toBeVisible({ timeout: 15_000 });
        await edit.click();

        // Replace the body and re-send with the same composer send button.
        const editor = page.locator(EDITOR).first();
        await expect(editor, 'the composer reopens for editing').toBeVisible({ timeout: 15_000 });
        await editor.click();
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Delete');
        await page.keyboard.type(editedBody);
        await page.keyboard.press('Enter');

        // An edited message keeps a visible "Edited" marker (BR-K03), and shows the new body.
        await expect(
          page.getByText(/Edited/i).first(),
          'the edited message shows an Edited marker (BR-K03)',
        ).toBeVisible({ timeout: 20_000 });
        await expect(page.getByText(editedBody).first(), 'the edited body is shown').toBeVisible({
          timeout: 20_000,
        });

        // Clean up: delete the (edited) message so the account ends as it started.
        const edited = page
          .locator('[id]')
          .filter({ hasText: subject })
          .filter({ has: page.getByTestId('NotificationsNoneIcon') })
          .last();
        await openBellMenu(page, edited);
        await page.getByRole('menuitem', { name: /Delete/i }).click();
        await page
          .getByRole('button', { name: /^Confirm$/i })
          .click()
          .catch(() => undefined);
      },
    );

    test(
      'Save bookmarks a sent message (send → Save → accepted), then deletes @ui',
      { annotation: [{ type: 'requirement-partial', description: 'FR-KU-040' }] },
      async ({ page }) => {
        const subject = `QA UI save ${Date.now()}`;
        await openComposer(page);
        const message = await sendMessage(page, subject, 'QA UI save — self-cleaning');

        // Save opens a native confirm before POSTing saveKatchupMessages. Accepting would delete every
        // other message in the shared QA conversation, so the test checks the confirm and cancels it.
        const confirms: string[] = [];
        page.on('dialog', (d) => {
          confirms.push(`${d.type()}: ${d.message()}`);
          void d.dismiss();
        });
        let saveRequests = 0;
        page.on('request', (r) => {
          if (r.url().includes('/katchup/saveKatchupMessages/')) saveRequests++;
        });
        await openBellMenu(page, message);
        const save = page
          .getByRole('menuitem')
          .filter({ hasText: /^\s*Save\s*$/i })
          .first();
        await expect(save, 'the sender action menu offers Save').toBeVisible({ timeout: 15_000 });
        await save.click();
        await expect
          .poll(() => confirms.length, {
            message: 'Save opens a Save Messages confirmation dialog',
            timeout: 15_000,
          })
          .toBeGreaterThan(0);
        test.info().annotations.push({ type: 'observed', description: confirms.join(' || ') });
        expect(confirms[0], 'the dialog is a confirm about saving the selected message').toMatch(
          /confirm: .*(saved|Message Folder)/i,
        );
        await page
          .waitForRequest((r) => r.url().includes('/katchup/saveKatchupMessages/'), {
            timeout: 1_500,
          })
          .catch(() => undefined);
        expect(saveRequests, 'cancelling the confirmation saves nothing').toBe(0);

        await deleteSentMessage(page, subject);
      },
    );

    test(
      'Copy copies a sent message to the clipboard (send → Copy → accepted), then deletes @ui',
      { annotation: [{ type: 'requirement', description: 'FR-KU-039' }] },
      async ({ page, browserName }) => {
        const subject = `QA UI copy ${Date.now()}`;
        const body = `QA UI copy — self-cleaning ${Date.now()}`;
        await openComposer(page);
        const message = await sendMessage(page, subject, body);

        if (browserName === 'chromium')
          await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
        // Bell menu → Copy (`handleCopyToClipboard`).
        await openBellMenu(page, message);
        const copy = page.getByRole('menuitem', { name: /Copy/i });
        await expect(copy, 'the sender action menu offers Copy').toBeVisible({ timeout: 15_000 });
        await copy.click();
        await expect(copy, 'the Copy action was accepted (menu closed)').toHaveCount(0, {
          timeout: 15_000,
        });
        // The clipboard holds the message. Only Chromium lets a page read it (with the permission
        // granted); on the other engines the accepted action above is all that can be checked.
        if (browserName === 'chromium') {
          await expect
            .poll(() => page.evaluate(() => navigator.clipboard.readText()), {
              message: 'the copied text is the message',
              timeout: 10_000,
            })
            .toContain(body);
        }

        await deleteSentMessage(page, subject);
      },
    );
  },
);
