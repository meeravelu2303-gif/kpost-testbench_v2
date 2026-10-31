import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { openConversation } from '../support/katchup';

/**
 * Contacts UI: the contact list/search in the Katchup rail and Settings > Blocked Contacts.
 * The block/unblock write flow is gated behind CONTACTS_UI_LIFECYCLE=true and restores itself.
 */
test.describe('KPost Contacts — read-only', { tag: ['@ui', '@contacts', '@regression'] }, () => {
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

    // Recents and Contacts panels both stay mounted; `.last()` is the on-screen Contacts copy. The
    // exact lowercase name skips the Frequently-Accessed strip's title-case copy of the same avatar.
    await expect(
      page.locator('[placeholder*="Search" i]').first(),
      'the contact search box is present',
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByRole('img', { name: 'hamza ali', exact: true }).last(),
      'a known contact is listed',
    ).toBeVisible({ timeout: 20_000 });
  });

  test('the Settings Blocked-Contacts screen renders its list @ui', async ({ page }) => {
    await page.goto('/settings', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page
      .locator('.loader-overlay')
      .waitFor({ state: 'hidden', timeout: 30_000 })
      .catch(() => undefined);

    // The section sits under the collapsed "General Settings" group.
    await page.getByText('General Settings', { exact: true }).first().click();
    await page.getByText('Blocked Contacts', { exact: true }).first().click();

    // The panel renders its list header ("Blocked Contact List • NN") or the empty state.
    await expect(
      page.getByText(/Blocked Contact List|No Blocked Contacts/i).first(),
      'the blocked-contacts panel renders',
    ).toBeVisible({ timeout: 20_000 });
  });
});

test.describe(
  'KPost Contacts — block / unblock (write)',
  { tag: ['@ui', '@contacts', '@regression'] },
  () => {
    test.skip(
      process.env.CONTACTS_UI_LIFECYCLE !== 'true',
      'blocks a real contact; set CONTACTS_UI_LIFECYCLE=true',
    );
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench') || !testData.victimKpostId,
      'needs both QA accounts',
    );

    /**
     * NEEDS-CODEGEN: the Block control (`BlockContact.js`) is a nested in-rail control, not on the
     * conversation's three-dot menu; its selector still needs one codegen pass.
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
  },
);
