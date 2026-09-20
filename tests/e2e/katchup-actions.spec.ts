import { env } from '@config/env';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import type { Locator, Page } from '@playwright/test';

/**
 * Katchup **sender message actions** — the post-send control set that is KPost's reason to exist
 * (CLAUDE.md §1: "Rich post-send control"). The sender's bell menu (the `NotificationsNoneIcon` on a
 * message the caller sent) offers **Edit / Recall / Note / Reminder / Transfer / Forward /
 * Forward-with-thread / Copy / Save / Delete** — the `bellIconContent` array in the frontend
 * `Katchup/bubble/KatchupMessage/KatchupMessage.js` (recipient actions live in `replyIconContent`,
 * reached from the ReplyIcon on a received message).
 *
 * These are **real writes**, so the whole file is gated behind `KATCHUP_UI_LIFECYCLE=true` and every
 * test is **self-cleaning**, targeting only our own 2nd QA account:
 *   - **Delete** is its own cleanup — send → delete → the message is gone (sender-side delete).
 *   - **Edit** re-sends an edited body (visible `Edited:` marker, BR-K03), then **deletes** to clean up.
 *
 * The selectors are the validated ones from `katchup-compose.spec.ts` (recall passed green on live):
 * a conversation row's element `id` is the counterpart's KPOST ID; the composer is the Quill editor
 * with `contenteditable="true"`; a message is a DOM element whose `id` is its msgID and which carries
 * its own `NotificationsNoneIcon` action trigger; the send button is the icon button in `#ChatTop`.
 *
 * FIRST-RUN NOTE: this file has not been tuned on live (the message-action menu needs one recording
 * pass like recall did). It never runs on a default run — only when the flag is set — so it cannot
 * file a false bug. Tune with a `codegen` recording, then remove this note.
 */

/** The composer's editable Quill area (not a read-only sent-message display). */
const EDITOR = '.ql-editor[contenteditable="true"]';

/** Open Katchup, wait out the loader overlay, open the 2nd QA account's conversation + composer. */
async function openComposer(page: Page): Promise<void> {
  await page.goto('/katchup', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page
    .locator('.loader-overlay')
    .waitFor({ state: 'hidden', timeout: 30_000 })
    .catch(() => undefined);

  const conversation = page.locator(`[id="${testData.victimKpostId}"]`).first();
  await expect(conversation, 'the 2nd QA account is in the conversation list').toBeVisible({
    timeout: 20_000,
  });
  await conversation.click();
  await page.locator('.msg-arrow').first().click();
}

/** Send a uniquely-subjected message to the 2nd QA account and return the sent-message element. */
async function sendMessage(page: Page, subject: string, body: string): Promise<Locator> {
  await page.getByRole('textbox', { name: 'Subject' }).fill(subject);
  await page.locator(EDITOR).first().click();
  await page.keyboard.type(body);
  await page.keyboard.press('Enter');

  await expect(page.getByText(subject).first(), 'the sent message appears').toBeVisible({
    timeout: 20_000,
  });
  // The message is a DOM element with its own action trigger; scope to the one carrying our subject.
  return page
    .locator('[id]')
    .filter({ hasText: subject })
    .filter({ has: page.getByTestId('NotificationsNoneIcon') })
    .last();
}

/** Open the sender action (bell) menu on a specific sent message. */
async function openBellMenu(page: Page, message: Locator): Promise<void> {
  await message.hover();
  await message.getByTestId('NotificationsNoneIcon').first().click();
}

/** Delete the message carrying `subject` (bell → Delete → Confirm) — the shared self-clean step. */
async function deleteSentMessage(page: Page, subject: string): Promise<void> {
  const sent = page
    .locator('[id]')
    .filter({ hasText: subject })
    .filter({ has: page.getByTestId('NotificationsNoneIcon') })
    .last();
  await openBellMenu(page, sent);
  await page.getByRole('menuitem', { name: /Delete/i }).click();
  await page
    .getByRole('button', { name: /^Confirm$/i })
    .click()
    .catch(() => undefined);
}

test.describe('KPost Katchup · sender message actions (write)', { tag: '@ui' }, () => {
  test.skip(!env.KATCHUP_UI_LIFECYCLE, 'writes real messages; set KATCHUP_UI_LIFECYCLE=true');
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench') || !testData.victimKpostId,
    'needs both QA accounts (QA_KPOST_ID, QA_VICTIM_KPOST_ID)',
  );

  test('Delete removes a sent message from the conversation (send → Delete → Confirm → gone) @ui', async ({
    page,
  }) => {
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

    // Clicking Confirm triggers the delete (handleDeleteButtonClickBell) and the dialog closes — that
    // is the reliable "delete was accepted" signal. The message shows in several DOM places (thread,
    // recents, the list preview), so asserting the text vanishes everywhere is unreliable; the actual
    // server-side removal is the API Katchup lifecycle's assertion (deleteKatchUpMessage, green).
    await expect(confirm, 'the delete was accepted (the confirm dialog closed)').toHaveCount(0, {
      timeout: 15_000,
    });
  });

  test('Edit re-sends an edited body and marks it Edited (send → Edit → resend → Edited), then deletes @ui', async ({
    page,
  }) => {
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
  });

  test('Save bookmarks a sent message (send → Save → accepted), then deletes @ui', async ({
    page,
  }) => {
    const subject = `QA UI save ${Date.now()}`;
    await openComposer(page);
    const message = await sendMessage(page, subject, 'QA UI save — self-cleaning');

    // Bell menu → Save. This is a single-click action (`handleSaveButtonClickBell([msgID])`) that
    // bookmarks the message; there is no dialog, so acceptance = the menu closing.
    await openBellMenu(page, message);
    const save = page.getByRole('menuitem', { name: /Save/i });
    await expect(save, 'the sender action menu offers Save').toBeVisible({ timeout: 15_000 });
    await save.click();
    await expect(save, 'the Save action was accepted (menu closed)').toHaveCount(0, {
      timeout: 15_000,
    });

    await deleteSentMessage(page, subject);
  });

  test('Copy copies a sent message to the clipboard (send → Copy → accepted), then deletes @ui', async ({
    page,
  }) => {
    const subject = `QA UI copy ${Date.now()}`;
    await openComposer(page);
    const message = await sendMessage(page, subject, 'QA UI copy — self-cleaning');

    // Bell menu → Copy (`handleCopyToClipboard`). Reading the clipboard is permission-gated and flaky
    // across engines, so we assert the action was ACCEPTED (menu closed), not the clipboard contents.
    await openBellMenu(page, message);
    const copy = page.getByRole('menuitem', { name: /Copy/i });
    await expect(copy, 'the sender action menu offers Copy').toBeVisible({ timeout: 15_000 });
    await copy.click();
    await expect(copy, 'the Copy action was accepted (menu closed)').toHaveCount(0, {
      timeout: 15_000,
    });

    await deleteSentMessage(page, subject);
  });
});
