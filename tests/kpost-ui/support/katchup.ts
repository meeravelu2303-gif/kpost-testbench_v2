import { testData } from '@config/test-data.config';
import { expect } from '@playwright/test';
import { setupStep } from '@ui/setup-step';
import type { Locator, Page } from '@playwright/test';

/**
 * Shared Katchup UI helpers. A conversation row's `id` is the counterpart's KPOST ID; the composer is
 * a Quill editor (type, never `.fill()`); a sent message is an element with its own bell icon.
 */

/** The composer's editable Quill area (not a read-only sent-message display). */
export const EDITOR = '.ql-editor[contenteditable="true"]';

/** Open Katchup, wait out the loader overlay, and open the conversation with `kpostId`. */
export async function openConversation(page: Page, kpostId: string): Promise<void> {
  await page.goto('/katchup', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page
    .locator('.loader-overlay')
    .waitFor({ state: 'hidden', timeout: 30_000 })
    .catch(() => undefined);

  await parkPointerAwayFromSideMenu(page);
  const conversation = page.locator(`[id="${kpostId}"]`).first();
  const listed = await conversation
    .waitFor({ state: 'visible', timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (listed) {
    await conversation.click();
    return;
  }
  // Recents renders only the latest conversations; when this one is pushed out, try the list search.
  const search = page.getByPlaceholder('Search').first();
  await expect(search, setupStep('the Katchup list search box renders')).toBeVisible({
    timeout: 10_000,
  });
  await search.fill(kpostId);
  const hit = page.locator(`[id="${kpostId}"], [id^="${kpostId}-"]`).first();
  if (await hit.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await hit.click();
    return;
  }
  // The Recents search may not match a KPOST ID, so fall back to Contacts tab → search → contact.
  await page.getByRole('tab', { name: 'Contacts' }).click();
  const local = kpostId.split('@')[0] ?? kpostId;
  await page.getByRole('searchbox', { name: 'Search' }).last().fill(local);
  const contact = page.getByRole('img', { name: new RegExp(`^${local} `, 'i') }).first();
  await expect(contact, setupStep(`${kpostId} is listed in My Contacts`)).toBeVisible({
    timeout: 20_000,
  });
  // The name (not the avatar) opens the chat; exact + visible-only skips hidden Recents previews.
  await page
    .getByText(new RegExp(`^${local} bench$`, 'i'))
    .filter({ visible: true })
    .first()
    .click();
  await expect(
    page.locator('.msg-arrow').first(),
    setupStep(`the conversation with ${kpostId} opens from Contacts`),
  ).toBeVisible({ timeout: 20_000 });
}

/** Open the conversation with `kpostId` and open its composer (the `.msg-arrow`). */
export async function openComposerFor(page: Page, kpostId: string): Promise<void> {
  await openConversation(page, kpostId);
  await page.locator('.msg-arrow').first().click();
}

/** Load /katchup and wait out the loader overlay (no conversation opened). */
export async function gotoKatchup(page: Page): Promise<void> {
  await page.goto('/katchup', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page
    .locator('.loader-overlay')
    .waitFor({ state: 'hidden', timeout: 30_000 })
    .catch(() => undefined);
}

/** Open a RECEIVED conversation by its unique `subject` (an unknown sender's row has no KPOST ID). */
export async function openReceivedConversation(page: Page, subject: string): Promise<void> {
  await gotoKatchup(page);
  const preview = page.getByText(subject).first();
  await expect(preview, `the received message "${subject}" is in the list`).toBeVisible({
    timeout: 25_000,
  });
  await preview.click();
}

/**
 * Open a GROUP conversation by its `groupKpostID`, reloading up to 4 times for a new group to reach
 * Recents. Returns false when it never shows. The pointer is parked first so the hover-expanded side
 * menu does not intercept the click.
 */
export async function openGroupConversation(page: Page, groupKpostID: string): Promise<boolean> {
  const groupRow = page.locator(`[id="${groupKpostID}"]`).first();
  for (let attempt = 1; attempt <= 4; attempt++) {
    await gotoKatchup(page);
    const found = await groupRow
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    if (found) {
      await parkPointerAwayFromSideMenu(page);
      await groupRow.click();
      return true;
    }
  }
  return false;
}

/** Move the pointer to the content area so the hover-expanding side menu collapses. */
export async function parkPointerAwayFromSideMenu(page: Page): Promise<void> {
  const size = page.viewportSize() ?? { width: 1280, height: 720 };
  await page.mouse.move(Math.round(size.width / 2), Math.round(size.height / 2));
}

/** Open the 2nd QA account's conversation + composer (the common sender case). */
export async function openComposer(page: Page): Promise<void> {
  await openComposerFor(page, testData.victimKpostId);
}

/** A message RECEIVED from the other account carries a `ReplyIcon` (recipient menu), not the bell. */
export function receivedMessageBySubject(page: Page, subject: string): Locator {
  return page
    .locator('[id]')
    .filter({ hasText: subject })
    .filter({ has: page.getByTestId('ReplyIcon') })
    .last();
}

/** Send with Enter (the app's own trigger, independent of the send-button layout); editor must be focused. */
export async function submitComposer(page: Page): Promise<void> {
  await page.keyboard.press('Enter');
}

/** Send a uniquely-subjected message to the 2nd QA account and return the sent-message element. */
export async function sendMessage(page: Page, subject: string, body: string): Promise<Locator> {
  await page.getByRole('textbox', { name: 'Subject' }).fill(subject);
  await page.locator(EDITOR).first().click();
  await page.keyboard.type(body);
  await submitComposer(page);

  await expect(page.getByText(subject).first(), 'the sent message appears').toBeVisible({
    timeout: 20_000,
  });
  return page
    .locator('[id]')
    .filter({ hasText: subject })
    .filter({ has: page.getByTestId('NotificationsNoneIcon') })
    .last();
}

/** Open the sender action (bell) menu on a specific sent message. */
export async function openBellMenu(page: Page, message: Locator): Promise<void> {
  // The bell only appears on hover, so scroll the message into view first.
  await message.scrollIntoViewIfNeeded().catch(() => undefined);
  // A re-rendering thread never passes the "stable" check, so hover is best-effort and the click forced.
  await message.hover().catch(() => undefined);
  await message.getByTestId('NotificationsNoneIcon').first().click({ force: true });
}

/** Open the recipient (`ReplyIcon`) menu on a RECEIVED message; same hover caveat as `openBellMenu`. */
export async function openReplyMenu(page: Page, message: Locator): Promise<void> {
  await message.scrollIntoViewIfNeeded().catch(() => undefined);
  await message.hover().catch(() => undefined);
  await message.getByTestId('ReplyIcon').first().click({ force: true });
}

/** Locate the sent message carrying `subject` (with its own bell trigger). */
export function messageBySubject(page: Page, subject: string): Locator {
  return page
    .locator('[id]')
    .filter({ hasText: subject })
    .filter({ has: page.getByTestId('NotificationsNoneIcon') })
    .last();
}

/** Delete the message carrying `subject` (bell → Delete → Confirm) — the shared self-clean step. */
export async function deleteSentMessage(page: Page, subject: string): Promise<void> {
  const sent = messageBySubject(page, subject);
  await openBellMenu(page, sent);
  await page.getByRole('menuitem', { name: /Delete/i }).click();
  await page
    .getByRole('button', { name: /^Confirm$/i })
    .click()
    .catch(() => undefined);
}
