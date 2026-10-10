import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import {
  EDITOR,
  deleteSentMessage,
  messageBySubject,
  openBellMenu,
  openComposer,
  sendMessage,
} from './support/katchup';

/**
 * Completes the "Note" sub-flow entry assertion already in katchup-actions-more.spec.ts, which
 * explicitly documents that only entry (menu item exists, clicking dismisses it) is proven there —
 * completion was left as a documented gap pending "one live recording pass".
 *
 * Read directly from source (KatchupMessage.js handleDropDownClick, bubble variant — the live
 * default theme): "Note" does not open a separate custom modal. It opens the SAME composer used for
 * an ordinary send (`setThreeDat({ writeMessage: true, ... })`), pre-populated with the original
 * message as reply context (`notMessage.Content`). So completing it means: click Note, the normal
 * composer opens, type a note body, send it — the existing `sendMessage`/`EDITOR` helpers apply
 * unchanged.
 */
test.describe('KPost Katchup · Note sub-flow completion @ui', { tag: '@ui' }, () => {
  test.skip(
    process.env.KATCHUP_UI_LIFECYCLE !== 'true',
    'writes real messages; set KATCHUP_UI_LIFECYCLE=true',
  );
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench') || !testData.victimKpostId,
    'needs both QA accounts',
  );

  test('Note opens the composer pre-filled with reply context, and the note itself sends @ui', async ({
    page,
  }) => {
    const sourceSubject = `QA UI Note source ${Date.now()}`;
    await openComposer(page);
    const source = await sendMessage(page, sourceSubject, 'QA UI Note — source message');

    await openBellMenu(page, source);
    const noteItem = page.getByRole('menuitem', { name: /Note/i });
    await expect(noteItem, 'the bell menu offers Note').toBeVisible({ timeout: 15_000 });
    await noteItem.click();

    // The composer should now be open (same editor used for an ordinary send).
    await expect(page.locator(EDITOR).first(), 'the composer opens for the Note').toBeVisible({
      timeout: 15_000,
    });

    // In this reply/note context the Subject is NOT an editable field — it's shown as read-only text
    // inherited from the source message (confirmed in source: WriteMessage.js renders
    // `{t("Subject")}: {Content.parentMsg.subject}` as plain text here, not an <input>). Only the body
    // is user-entered.
    await expect(
      page.getByText(sourceSubject, { exact: false }).first(),
      "the Note composer shows the source message's subject as inherited, read-only context",
    ).toBeVisible({ timeout: 10_000 });

    const noteBody = `QA UI note body ${Date.now()} — completing the documented sub-flow gap`;
    await page.locator(EDITOR).first().click();
    await page.keyboard.type(noteBody);
    await page.keyboard.press('Enter');

    await expect(
      page.getByText(noteBody).first(),
      'the note is actually sent (completion, not just entry)',
    ).toBeVisible({ timeout: 20_000 });

    // Self-clean: delete the note (located by its own body text) and the source message.
    const noteMessage = page
      .locator('[id]')
      .filter({ hasText: noteBody })
      .filter({ has: page.getByTestId('NotificationsNoneIcon') })
      .last();
    if (await noteMessage.count()) {
      await openBellMenu(page, noteMessage);
      await page.getByRole('menuitem', { name: /Delete/i }).click();
      await page
        .getByRole('button', { name: /^Confirm$/i })
        .click()
        .catch(() => undefined);
    }
    if (await messageBySubject(page, sourceSubject).count()) {
      await deleteSentMessage(page, sourceSubject);
    }
  });
});
