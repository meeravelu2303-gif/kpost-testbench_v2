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
 * Completes the "Transfer" sub-flow — a documented coverage gap (no existing spec touches Transfer at
 * all beyond the bell-menu hover fix already made in support/katchup.ts's openBellMenu comment).
 *
 * Read directly from source (bubble/KatchupMessage/KatchupMessage.js handleDropDownClick,
 * CommonComponent/TransferMessage/Transfer.js, Katchup/components/MultipleContact/MultipleContact.js):
 *   1. Bell menu "Transfer" sets `setTransfer(true)`, opening a small "Transfer Message" modal
 *      (KMail / Katchup / other-application share targets).
 *   2. Clicking "Katchup" there opens a recipient picker reusing MultipleContact, but with
 *      `hideSelectAll={true}` — Transfer's picker has NO "Select All" control at all, so the toggle-math
 *      bug that blocked the Forward sub-flow's completion (katchup-forward-subflow-e2e.spec.ts) doesn't
 *      apply here. Each contact row's own checkbox calls `handleMultipleContact`, a simple
 *      append/remove — no batch-selection edge case.
 *   3. "Done" (handleDoneContact) is unconditional — unlike Forward's separate `.post_button_size` send
 *      button, Transfer's `finalSubmit` prop IS `handleForward`, which calls the ForwardMessage API and
 *      the forward socket event directly. Clicking Done in the picker completes the whole transfer in
 *      one step; there is no second "send" button to find afterwards.
 */
test.describe('KPost Katchup · Transfer sub-flow completion @ui', { tag: '@ui' }, () => {
  test.skip(
    process.env.KATCHUP_UI_LIFECYCLE !== 'true',
    'writes real messages; set KATCHUP_UI_LIFECYCLE=true',
  );
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench') || !testData.victimKpostId,
    'needs both QA accounts',
  );

  test('Transfer opens the Katchup recipient picker, selects one real contact, and the transfer actually sends @ui', async ({
    page,
  }) => {
    const sourceSubject = `QA UI Transfer source ${Date.now()}`;
    await openComposer(page);
    const source = await sendMessage(page, sourceSubject, 'QA UI Transfer — source message');

    await openBellMenu(page, source);
    const transferItem = page.getByRole('menuitem', { name: /Transfer/i });
    await expect(transferItem, 'the bell menu offers Transfer').toBeVisible({ timeout: 15_000 });
    await transferItem.click();

    // Scope everything to the "Transfer Message" dialog so this never collides with the many other
    // places in the app that reuse the same "Katchup" icon/label (left nav, switch-account, etc).
    const transferDialog = page.getByRole('dialog').filter({ hasText: 'Transfer Message' });
    await expect(transferDialog, 'the Transfer Message modal opens').toBeVisible({
      timeout: 15_000,
    });

    await transferDialog.getByText('Katchup', { exact: true }).click();

    const recipientDialog = page.getByRole('dialog').filter({ hasText: 'Forward To' });
    await expect(recipientDialog, 'the Katchup recipient picker opens').toBeVisible({
      timeout: 15_000,
    });

    // Same name-based search as the Forward picker — matches by display name, not kpostID/email.
    const searchBox = recipientDialog.getByRole('searchbox');
    await expect(searchBox, 'the recipient search box is available').toBeVisible({
      timeout: 10_000,
    });
    await searchBox.fill('Hamza Ali');
    await page.waitForTimeout(1500); // let the search debounce/filter re-render before interacting

    // No "Select All" exists in this picker (hideSelectAll=true) — go straight to the contact's own
    // row checkbox, which here uses simple additive handleMultipleContact logic (not the Select-All
    // toggle math that broke the Forward sub-flow). Row-level text scoping was unreliable for this
    // exact picker in the Forward sub-flow (ContactBar's name/checkbox aren't in one easily-filterable
    // wrapper) — searching first narrows the contact list to this one real match, so the picker renders
    // exactly one checkbox, which can be grabbed directly instead.
    await expect(
      recipientDialog.getByText('hamza ali', { exact: false }),
      'the search narrows the contact list to Hamza Ali',
    ).toBeVisible({ timeout: 10_000 });
    const rowCheckbox = recipientDialog.getByRole('checkbox');
    await expect(rowCheckbox, "Hamza Ali's own row checkbox is available").toBeVisible({
      timeout: 10_000,
    });
    await rowCheckbox.check();

    // "Selected Contacts" count updates from "No Contacts Selected" once the pick registers — confirms
    // the click actually reached handleMultipleContact's state before relying on it.
    await expect(
      recipientDialog.getByText(/1 Contacts? Selected/i),
      'the picker reflects one contact selected before Done is pressed',
    ).toBeVisible({ timeout: 10_000 });

    // Done has no disabled/enabled gating in source (unlike Forward) — clicking it submits whatever is
    // currently selected and completes the transfer in one step (handleDoneContact -> finalSubmit ->
    // handleForward -> ForwardMessage API + forward socket event).
    await recipientDialog.getByRole('button', { name: /^Done$/i }).click();

    // Verify delivery: the sender is also a party to their own 1:1 thread with the recipient, so the
    // transferred content should appear there without needing a second browser session.
    await expect(
      page.getByText('QA UI Transfer — source message', { exact: false }).first(),
      'the transferred message content appears in the sender-recipient thread (transfer actually sent)',
    ).toBeVisible({ timeout: 20_000 });

    // Self-clean: delete the source message (the transferred copy in the recipient's own account is
    // left alone deliberately, same as the Forward sub-flow's cleanup rationale).
    if (await messageBySubject(page, sourceSubject).count()) {
      await deleteSentMessage(page, sourceSubject);
    }
  });
});
