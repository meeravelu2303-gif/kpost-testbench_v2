import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { openConversation } from './support/katchup';

/**
 * Completes the "Share digital card" compose-time feature (FR-K17), a documented coverage gap
 * ("the shared card is verified in the recipient conversation; needs 2 sessions" in
 * src/ui/katchup-features.ts) — this test only needs ONE session, since the sender can also open the
 * recipient's own thread to verify delivery, same pattern already proven for Forward/Transfer today.
 *
 * Read directly from source (bubble/DigitalCard/DigitalCard.js, bubble/ShareContactTo/ShareContactTo.js
 * — both confirmed live via the thread header's ContactBar `imgClick`):
 *   1. Opening a conversation's header avatar (`imgClick`) sets `setProfileModal(true)`, opening the
 *      Digital Card for the thread's counterpart.
 *   2. The Digital Card's Share icon (`FiShare2`, class `dc-secondary-icon`, no accessible name) opens
 *      ShareContactTo's main screen (`dirState.shareTo = true`) — a KMail/Katchup/Other-Applications
 *      icon grid, confirmed genuinely functional: `sendKatchup` (DigitalCard.js:494-550) calls the real
 *      `SendMessage` API with `messageType: 22` and reports a real "Contact Shared successfully" toast
 *      on success — unlike the Share Location feature (separately confirmed this session to be a
 *      non-functional stub whose send call is commented out).
 *   3. Clicking "Katchup" in that screen sets `shareState.forwardTo = true`, opening the same
 *      `MultipleContact` picker pattern as Transfer (`hideSelectAll={true}`, search-narrows-to-one,
 *      grab the resulting single checkbox directly) — `selectedContact={selectContact}` here excludes
 *      the card's own owner (Hamza) from the picker, same rationale as Forward's exclusion, so the
 *      share target here is a different real contact ("Kapildev Thagapillai", already confirmed in
 *      this account's address book and reused from the Forward sub-flow test for the same reason).
 *
 * NOT COMPLETED — root cause found and filed as #979, not a selector problem. The Digital Card modal
 * itself opens correctly and reliably (its own "View Profile" CTA renders every time) — the underlying
 * flow (steps 1-3 above) is real, traced from source, and confirmed functional. What actually blocks
 * this test is a session-stability bug, confirmed via a dedicated diagnostic (live network/navigation
 * logging): simply opening a Katchup conversation triggers 200+ background profile/group-image fetches
 * (`/v2/profile/downloadProfileImage/...`, `/v2/group/downloadGroupProfileImage/...`), a large fraction
 * of which correctly 401 (images belonging to other company tenants this account has no access to —
 * confirmed 220+ such 401s BEFORE the Digital Card avatar is even clicked). The global fetch
 * interceptor (`src/interceptFetch.js:269-308`) treats ANY non-"token expired" 401 on these domains as
 * grounds to force-logout via `window.location.replace('/login')` (`beginLogout()`, line 169) — with no
 * distinction between the user's own session being invalid and one irrelevant background image being
 * correctly denied. The result: within ~5 seconds of opening ANY Katchup conversation on an account with
 * enough historical groups/contacts, the session gets killed out from under the test, independent of
 * anything this test does with the Share button. Filed as **#979** (CRITICAL) — this test cannot run
 * reliably until that session-killing bug is fixed, since the session may already be dead before the
 * Share icon is even reached.
 */
const SHARE_TARGET_CONTACT_ID = '8056go@kpostindia.com';
const SHARE_TARGET_SEARCH_TERM = 'Kapildev';

test.describe('KPost Katchup · Digital Card share @ui', { tag: '@ui' }, () => {
  test.skip(
    process.env.KATCHUP_UI_LIFECYCLE !== 'true',
    'sends a real message; set KATCHUP_UI_LIFECYCLE=true',
  );
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench') || !testData.victimKpostId,
    'needs both QA accounts',
  );

  test("sharing a contact's Digital Card via Katchup actually sends it @ui", async ({ page }) => {
    // Inside the test body, not at the describe level — see the note in katchup-two-session.spec.ts's
    // unread-badge test for why that placement matters (it silently skips sibling tests otherwise).
    test.fixme(
      true,
      'blocked by #979 — the session gets force-logged-out from an unrelated background-image 401 within seconds of opening any Katchup conversation, independent of the Share flow itself — see the comment above',
    );
    await openConversation(page, testData.victimKpostId);

    // The thread header's avatar is the Digital Card trigger — a shared `ContactBar` renders it as
    // `<Avatar onClick={imgClick} className="font-Family-Nunito ..." />` (common/ContactBar/
    // ContactBar.js:378-402), scoped to the header row by its `background-color-katchup` class.
    const headerAvatar = page
      .locator('.background-color-katchup')
      .locator('.font-Family-Nunito')
      .first();
    await headerAvatar.click({ timeout: 15_000 });

    // Wait for the Digital Card modal to actually finish rendering before touching anything inside it
    // — "View Profile" (DigitalCard.js's own CTA, always present) is the sync point.
    await expect(
      page.getByText('View Profile', { exact: true }).first(),
      'the Digital Card modal opens',
    ).toBeVisible({ timeout: 15_000 });

    const shareButton = page.locator('.dc-secondary-icon').first();
    await expect(shareButton, 'the Digital Card Share icon is available').toBeVisible({
      timeout: 15_000,
    });
    await shareButton.scrollIntoViewIfNeeded().catch(() => undefined);
    await shareButton.click({ force: true, timeout: 10_000 });

    const shareDialog = page.getByRole('dialog').filter({ hasText: 'Other Applications' });
    await expect(shareDialog, 'the share-target screen opens').toBeVisible({ timeout: 15_000 });
    await shareDialog.getByText('Katchup', { exact: true }).click();

    const recipientDialog = page.getByRole('dialog').filter({ hasText: 'Forward To' });
    await expect(recipientDialog, 'the Katchup recipient picker opens').toBeVisible({
      timeout: 15_000,
    });
    const searchBox = recipientDialog.getByRole('searchbox');
    await expect(searchBox, 'the recipient search box is available').toBeVisible({
      timeout: 10_000,
    });
    await searchBox.fill(SHARE_TARGET_SEARCH_TERM);
    await page.waitForTimeout(1500);

    await expect(
      recipientDialog.getByText(SHARE_TARGET_SEARCH_TERM, { exact: false }),
      `the search narrows the contact list to ${SHARE_TARGET_SEARCH_TERM}`,
    ).toBeVisible({ timeout: 10_000 });

    // hideSelectAll=true here too — the search-narrowed list renders exactly one checkbox.
    const rowCheckbox = recipientDialog.getByRole('checkbox');
    await expect(rowCheckbox, "the target contact's own row checkbox is available").toBeVisible({
      timeout: 10_000,
    });
    await rowCheckbox.check();
    await recipientDialog.getByRole('button', { name: /^Done$/i }).click();

    await expect(
      page.getByText('Contact Shared successfully', { exact: false }),
      'the app confirms the share actually sent',
    ).toBeVisible({ timeout: 15_000 });

    // Verify delivery: open the target's own thread from the sender's side.
    await openConversation(page, SHARE_TARGET_CONTACT_ID);
    await expect(
      page.getByText('Sharing Kpost Digital Card', { exact: false }).first(),
      "the shared Digital Card message appears in the target's thread",
    ).toBeVisible({ timeout: 20_000 });
  });
});
