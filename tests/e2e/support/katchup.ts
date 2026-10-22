import { testData } from '@config/test-data.config';
import { expect } from '@playwright/test';
import { setupStep } from '@ui/setup-step';
import type { Locator, Page } from '@playwright/test';

/**
 * Shared Katchup UI helpers — the validated selectors and steps (recall passed green on live) reused
 * across the Katchup specs so a selector lives in one place:
 *   - a conversation row's element `id` is the counterpart's KPOST ID,
 *   - the composer is the Quill editor with `contenteditable="true"` (type, never `.fill()`),
 *   - a `.loader-overlay` intercepts clicks while the SPA loads,
 *   - a message is a DOM element whose `id` is its msgID with its own `NotificationsNoneIcon` (bell),
 *   - the send button is the icon button in `#ChatTop`.
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
  // The Recents list only renders the most recent conversations ("Today 20"); once other threads
  // (e.g. the QA UI groups, 2026-10-11) push this one out, find it through the list's own search box
  // (`RecentMessage.js` → search categories; result rows are keyed `<kpostId>-<msgID|time>`).
  const search = page.getByPlaceholder('Search').first();
  await expect(search, setupStep('the Katchup list search box renders')).toBeVisible({
    timeout: 10_000,
  });
  await search.fill(kpostId);
  const hit = page.locator(`[id="${kpostId}"], [id^="${kpostId}-"]`).first();
  await expect(
    hit,
    setupStep(`the conversation with ${kpostId} is found through the list search`),
  ).toBeVisible({ timeout: 20_000 });
  await hit.click();
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

/**
 * Open a RECEIVED conversation by the message's unique `subject` — the sender may be an unknown
 * contact (so its row is not keyed by `[id=<kpostId>]`), but the list preview shows the subject, and
 * clicking it opens the thread.
 */
export async function openReceivedConversation(page: Page, subject: string): Promise<void> {
  await gotoKatchup(page);
  const preview = page.getByText(subject).first();
  await expect(preview, `the received message "${subject}" is in the list`).toBeVisible({
    timeout: 25_000,
  });
  await preview.click();
}

/**
 * Open a GROUP conversation by its `groupKpostID`. A freshly created group is in the Recents list
 * (its row `id` is the groupKpostID — `RecentMessage.js`): creating it posts the "<creator> added
 * <members>" activity message, which gives it a Recents entry. A group created moments ago through the
 * API can take a reload or two to appear (the list is fetched once per load). Returns false, without
 * failing, when the group never shows: the caller decides what that means.
 *
 * Measured live 2026-10-10: the row sits at x≈82–455 in a 1280px viewport, and the left side menu
 * (`.menu.menuss1`, `Header.js`) widens from 60px to `clamp(190px, 12vw, 240px)` while the pointer
 * is over it and stays open as long as the pointer stays inside — which it does once Playwright moves
 * the pointer to the row's centre (x≈269) while the menu is already open. Every row click then reports
 * "`.menu` subtree intercepts pointer events" until it times out (4/4 Group Info failures). Parking
 * the pointer over the thread area first collapses the menu, and the click lands.
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

/**
 * Move the pointer over the main content area so the hover-expanding side menu (`.menu.menuss1`)
 * collapses back to 60px and stops covering the left list column. Idempotent and cheap.
 */
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

/**
 * Submit the composer by pressing **Enter** in the editor — the app's own send trigger
 * (`WriteMessage.js` `handleKeyDown`: Enter without Shift → `handleKatchupSubmit`). This is immune to
 * the composer's button layout (the send icon moves / is disabled-until-ready in the K-AI variant),
 * so it works in every composer state. Assumes the editor is focused (type into it first).
 */
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
  // Bring the message into view first — a message low in a scrollable thread is not hoverable until
  // scrolled to (the bell action only appears on hover).
  await message.scrollIntoViewIfNeeded().catch(() => undefined);
  // Hover reveals the bell, but a still-rendering thread churns the message's layout so a strict hover
  // can never satisfy the "stable" actionability check (seen as a 15s timeout on Transfer). Hover is
  // therefore best-effort, and the bell is clicked with `force`: the click handler is attached
  // regardless of the hover-reveal opacity, and `force` skips the stability wait that was flaking.
  await message.hover().catch(() => undefined);
  await message.getByTestId('NotificationsNoneIcon').first().click({ force: true });
}

/**
 * Open the recipient action menu (the `ReplyIcon` trigger) on a RECEIVED message — the receive-side
 * twin of `openBellMenu`, same hover-reveal caveat, so the same best-effort hover + forced click.
 */
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
