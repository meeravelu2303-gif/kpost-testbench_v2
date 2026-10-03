import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import {
  EDITOR,
  deleteSentMessage,
  messageBySubject,
  openBellMenu,
  openComposer,
  openConversation,
  sendMessage,
} from './support/katchup';

/** A real contact in the primary QA account's own address book, distinct from `victimKpostId` —
 * needed because Forward excludes the currently-open thread's counterpart from its own recipient
 * list (see the class comment below). Confirmed present via the `contacts-my-contacts` API. */
const FORWARD_TARGET_CONTACT_ID = '8056go@kpostindia.com';
const FORWARD_TARGET_SEARCH_TERM = 'Kapildev';

/**
 * Completes the "Forward" sub-flow entry assertion already in katchup-actions-more.spec.ts, which
 * explicitly documents completion as a gap ("needs one live recording pass").
 *
 * Read directly from source (bubble/forwardFooter/ForwardFooter.js, bubble/MultipleContact/
 * MultipleContact.js — bubble confirmed live/default via Katchup.js's dynamic require):
 *   1. Bell menu "Forward" sets up `selectedMsg` and reveals a circular forward-trigger icon
 *      (`fDIcon`, onClick -> setForwardModal(true)).
 *   2. The "Forward To" picker (MultipleContact, `hideSelectAll={false}`) opens; typing in
 *      "Search Contacts" narrows the list to exactly one real contact.
 *   3. "Done" (handleDoneContact) only stores the selection and closes the picker — it does NOT
 *      send. The actual send is a separate button back in the forward view, class
 *      `post_button_size` (no accessible name — the same gap already filed as #963), which calls
 *      handleKatchupSubmit().
 *
 * Selection fix (2026-10-03): earlier attempts used "Select All" (its toggle-based handleSelectAll
 * math left the button disabled even though the checkbox rendered checked — a real edge case, but
 * one the app doesn't require using) and a row-scoped-by-text locator for the individual checkbox
 * (unreliable — ContactBar's name text and its own checkbox aren't both inside one cleanly filterable
 * wrapper). The fix proven on the sibling Transfer picker (katchup-transfer-subflow-e2e.spec.ts, same
 * ContactBar-based row rendering): searching first narrows the list to exactly one contact, so the
 * dialog renders exactly two checkboxes total — "Select All" (first) and this one contact's own row
 * checkbox (last) — and the per-row checkbox uses simple additive handleMultipleContact logic with no
 * toggle-math edge case.
 *
 * Recipient choice (2026-10-03): this picker is NOT interchangeable with Transfer's — ForwardFooter.js
 * passes `selectedContact={selectContact}` (the currently-open thread's counterpart) into
 * MultipleContact, whose `filterOutSelectedContact` removes that exact contact from the list before
 * the search even runs. Forwarding a message FROM the Hamza Ali thread TO Hamza Ali therefore
 * correctly shows "No Contacts" — confirmed by reading the victim contact's own raw record via the
 * `contacts-my-contacts` API (firstName/lastName "hamza"/"ali", no casing or data issue) and tracing
 * the exclusion in source; this is the app working as designed, not a bug. The forward target here
 * must be a different real contact already in the account's own address book — "Kapildev Thagapillai"
 * (contactID 8056go@kpostindia.com), confirmed present via that same API read.
 */
test.describe('KPost Katchup · Forward sub-flow completion @ui', { tag: '@ui' }, () => {
  test.skip(
    process.env.KATCHUP_UI_LIFECYCLE !== 'true',
    'writes real messages; set KATCHUP_UI_LIFECYCLE=true',
  );
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench') || !testData.victimKpostId,
    'needs both QA accounts',
  );

  test('Forward opens the recipient picker, narrows to one real contact, and the forward actually sends @ui', async ({
    page,
  }) => {
    const sourceSubject = `QA UI Forward source ${Date.now()}`;
    await openComposer(page);
    const source = await sendMessage(page, sourceSubject, 'QA UI Forward — source message');

    await openBellMenu(page, source);
    const forwardItem = page.getByRole('menuitem', { name: /Forward\s*$/i });
    await expect(forwardItem, 'the bell menu offers Forward').toBeVisible({ timeout: 15_000 });
    await forwardItem.click();
    await expect(forwardItem, 'Forward was accepted (menu item dismissed)').toBeHidden({
      timeout: 15_000,
    });

    // The circular "Forward To" trigger appears once a message is staged for forwarding.
    const forwardToTrigger = page
      .locator('[class*="blueBack"], [style*="border-radius: 50%"]')
      .filter({ has: page.locator('svg, img') })
      .last();
    await forwardToTrigger.click({ timeout: 15_000 }).catch(async () => {
      // Fallback: the trigger may just be any clickable circular icon near the forward footer —
      // try the most generic candidate the source confirms exists (fDIcon-controlled onClick).
      await page.locator('div[style*="border-radius"]').last().click({ timeout: 10_000 });
    });

    // Scope everything to the "Forward To" dialog so row/checkbox lookups never collide with the
    // Katchup page rendered behind it (same scoping fix used by the Transfer sub-flow test).
    const recipientDialog = page.getByRole('dialog').filter({ hasText: 'Forward To' });
    await expect(recipientDialog, 'the Forward To recipient picker opens').toBeVisible({
      timeout: 15_000,
    });
    const searchBox = recipientDialog.getByRole('searchbox');
    await expect(searchBox, 'the recipient search box is available').toBeVisible({ timeout: 10_000 });
    // This search matches contacts by DISPLAY NAME, not kpostID/email. The Hamza Ali conversation
    // partner is excluded from this specific picker (see class comment), so the target here is a
    // different real contact already in the account's own address book.
    await searchBox.fill(FORWARD_TARGET_SEARCH_TERM);
    await page.waitForTimeout(1500); // let the search debounce/filter re-render before interacting

    await expect(
      recipientDialog.getByText(FORWARD_TARGET_SEARCH_TERM, { exact: false }),
      `the search narrows the contact list to ${FORWARD_TARGET_SEARCH_TERM}`,
    ).toBeVisible({ timeout: 10_000 });

    // With the list narrowed to one contact, the dialog renders exactly two checkboxes: "Select All"
    // (first, hideSelectAll=false here) and this one contact's own row (last) — grab the row checkbox
    // directly instead of trying to scope it by surrounding row text.
    const rowCheckbox = recipientDialog.getByRole('checkbox').last();
    await expect(rowCheckbox, "the target contact's own row checkbox is available").toBeVisible({
      timeout: 10_000,
    });
    await rowCheckbox.check();

    const doneButton = recipientDialog.getByRole('button', { name: /^Done$/i });
    await expect(doneButton, 'Done is available once a contact is selected').toBeVisible({
      timeout: 5_000,
    });
    await doneButton.click();
    await page.waitForTimeout(1000);

    // Back in the forward view: the final send button (post_button_size, no accessible name — #963).
    const finalSend = page.locator('.post_button_size').last();
    await expect(finalSend, 'the final Forward send button is enabled once a recipient is picked').toBeEnabled({
      timeout: 10_000,
    });
    await finalSend.click();

    // Verify delivery: the sender is also a party to their own 1:1 thread with the forward target, so
    // the forwarded content should appear there without needing a second browser session. This is a
    // different conversation than the Hamza Ali one the source message was sent in.
    await page.locator(EDITOR).first().waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => undefined);
    await openConversation(page, FORWARD_TARGET_CONTACT_ID);
    await expect(
      page.getByText('QA UI Forward — source message', { exact: false }).first(),
      'the forwarded message content appears in the sender-target thread (forward actually sent)',
    ).toBeVisible({ timeout: 20_000 });

    // Self-clean: delete the forwarded copy from the sender's side of the target conversation, then
    // the original source message in the Hamza Ali thread (the forward copy in the actual recipient's
    // own account is left alone deliberately — recalling/deleting someone else's received copy is not
    // how this app works, same business rule BR-KU-RECALL already covers).
    const forwardedCopySubject = messageBySubject(page, sourceSubject);
    if (await forwardedCopySubject.count()) {
      await deleteSentMessage(page, sourceSubject);
    }
    await openConversation(page, testData.victimKpostId);
    if (await messageBySubject(page, sourceSubject).count()) {
      await deleteSentMessage(page, sourceSubject);
    }
  });
});
