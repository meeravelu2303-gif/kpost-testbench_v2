import { TAGS } from '@config/constants';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { contactsSearchBox, gotoContacts } from '../support/contacts';
import { requirePersonalAccount } from './smoke-ui';

/**
 * UI SMOKE · Contacts — the Contacts tab opens and finds a known contact: qatest2 is qatest1's
 * standing QA contact (the bench re-adds it whenever a test removes it). Read-only.
 */
test.describe(
  'SMOKE · UI · Contacts',
  { tag: [TAGS.ui, TAGS.contacts, TAGS.smoke, TAGS.sanity, TAGS.regression] },
  () => {
    requirePersonalAccount();
    test.skip(!testData.victimKpostId, 'needs the second QA account (QA_VICTIM_KPOST_ID)');

    test('the contact list opens and finds a known contact', async ({ page }) => {
      expect(await gotoContacts(page), 'the Contacts tab opens with its search box').toBe(true);
      const known = testData.victimKpostId.split('@')[0]!;
      await contactsSearchBox(page).fill(known);
      // Match the avatar image: the plain name also appears in hidden Recents previews.
      await expect(
        page.getByRole('img', { name: new RegExp(`^${known} `, 'i') }).first(),
        `My Contacts lists ${known}`,
      ).toBeVisible({ timeout: 20_000 });
    });
  },
);
