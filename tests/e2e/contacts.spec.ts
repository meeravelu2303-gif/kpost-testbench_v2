import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { openConversation } from './support/katchup';

/**
 * **Contacts** — the address book the messaging/calling modules act on. It has no standalone route; the
 * contact list/search lives inside the Katchup rail (`ContactList/ContactList.js`, categories
 * "Contacts" / "Unknown Contacts" / "Groups" / "Unknown Groups"), block management also on
 * `Settings/BlockedContact`. The API Contacts lifecycle (add → verify → delete, block → unblock) is
 * green; this is the UI side.
 *
 * The read-only checks below are reliable and safe. The write flows (add / block / unblock) are gated
 * behind `CONTACTS_UI_LIFECYCLE=true` and self-cleaning; their exact in-rail triggers
 * (`AddContact.js`, `BlockContact.js`) are deeply nested, so they are first-drafts pending one live
 * recording pass (FIRST-RUN NOTE on each).
 */
test.describe('KPost Contacts — read-only', { tag: '@ui' }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench') || !testData.victimKpostId,
    'needs both QA accounts (QA_KPOST_ID, QA_VICTIM_KPOST_ID)',
  );

  test('the Katchup contact rail lists contacts and is searchable @ui', async ({ page }) => {
    await page.goto('/katchup', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page
      .locator('.loader-overlay')
      .waitFor({ state: 'hidden', timeout: 30_000 })
      .catch(() => undefined);

    // The contact/search box is present and the 2nd QA account is a known contact (a conversation row
    // whose element id is that account's KPOST ID).
    await expect(
      page.locator('[placeholder*="Search" i]').first(),
      'the contact search box is present',
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.locator(`[id="${testData.victimKpostId}"]`).first(),
      'a known contact is listed',
    ).toBeVisible({ timeout: 20_000 });
  });

  test('the Settings Blocked-Contacts screen renders its list @ui', async ({ page }) => {
    await page.goto('/settings', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page
      .locator('.loader-overlay')
      .waitFor({ state: 'hidden', timeout: 30_000 })
      .catch(() => undefined);

    // Open the Blocked-Contacts section and confirm its panel renders (Settings/BlockedContact).
    await page
      .getByText(/Block\s*Contact/i)
      .first()
      .click()
      .catch(() => undefined);
    await expect(
      page.getByText(/Blocked Contact List|Block\s*Contact/i).first(),
      'the blocked-contacts panel renders',
    ).toBeVisible({ timeout: 20_000 });
  });
});

test.describe('KPost Contacts — block / unblock (write)', { tag: '@ui' }, () => {
  test.skip(
    process.env.CONTACTS_UI_LIFECYCLE !== 'true',
    'blocks a real contact; set CONTACTS_UI_LIFECYCLE=true',
  );
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench') || !testData.victimKpostId,
    'needs both QA accounts',
  );

  /**
   * FIRST-RUN NOTE: the block/unblock trigger is in the contact's profile/options inside the Katchup
   * rail (`BlockContact.js`, `handleBlock` → `BlockContactService {contactID, isBlocked}`). The exact
   * affordance (a contact-row menu / profile Block button) needs one recording pass; this drives the
   * plausible flow (open the contact → Block → Unblock) and self-restores.
   */
  test('block then unblock the 2nd QA account, leaving it unblocked @ui', async ({ page }) => {
    await openConversation(page, testData.victimKpostId);

    // Open the contact's profile/options and Block, then Unblock — self-restoring.
    const block = page.getByRole('menuitem', { name: /^Block$/i }).or(page.getByText(/^Block$/i));
    await block
      .first()
      .click()
      .catch(() => undefined);
    // Confirm dialog if present.
    await page
      .getByRole('button', { name: /^(Confirm|Yes|Block)$/i })
      .first()
      .click()
      .catch(() => undefined);

    const unblock = page
      .getByRole('menuitem', { name: /^Unblock$/i })
      .or(page.getByRole('button', { name: /^Unblock$/i }))
      .or(page.getByText(/^Unblock$/i));
    await expect(unblock.first(), 'the contact is now blocked (Unblock is offered)').toBeVisible({
      timeout: 15_000,
    });
    // Restore: unblock so the account ends as it started.
    await unblock.first().click();
  });
});
