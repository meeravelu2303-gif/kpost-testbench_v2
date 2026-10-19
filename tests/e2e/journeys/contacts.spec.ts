import { STORAGE_STATE, TAGS } from '@config/constants';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { contactsSearchBox, gotoContacts, openPeopleSearch } from '../support/contacts';
import { A, requireAccounts, requireFlags, restoreSavedSession } from './support/journey';

/**
 * JOURNEY 6 · BUILDING AN ADDRESS BOOK — find someone in the directory and keep them as a contact.
 *
 * A opens KDirectory people search → finds a person by mobile number → adds them → the contact is in
 * A's Contacts list in the UI → and in A's contacts on the server → the contact is removed again.
 *
 * Order matters because of the one-session rule: the server check and the clean-up are API calls as
 * A, which sign A's browser out, so they come LAST and the journey ends by signing A back in through
 * the real login screen (`restoreSavedSession`), leaving `.auth/user.json` valid for the rest of the run.
 *
 * UNPROVEN STEP (first live run): finding the new contact in the Contacts tab's own search. Adding is
 * proven (`contacts-functional.spec.ts`); listing it in the tab has not been asserted before.
 * Not covered: removing a contact in the UI and starting a chat from a contact card — neither has a
 * recorded UI path yet; removal runs through the API.
 */
test.describe(
  'JOURNEY 6 · building an address book',
  { tag: [TAGS.ui, TAGS.journey, TAGS.contacts, TAGS.regression] },
  () => {
    test.describe.configure({ timeout: 180_000 });
    requireAccounts('A');
    requireFlags('CONTACTS_UI_LIFECYCLE');

    test('A finds a person in the directory, adds them, and sees them in Contacts', async ({
      page,
      endpoints,
    }) => {
      let addedId: string | undefined;
      let sessionUsedByApi = false;
      await page.route('**/contacts/addContact**', async (route) => {
        try {
          const d = route.request().postDataJSON() as { contactID?: string; contactId?: string };
          addedId = d?.contactID ?? d?.contactId ?? addedId;
        } catch {
          /* the assertion below reports a missing dispatch */
        }
        await route.continue();
      });

      try {
        await test.step('A finds the person in the directory by mobile number', async () => {
          const search = await openPeopleSearch(page);
          expect(search, 'the directory people search opens').not.toBeNull();
          await search!.click();
          await search!.fill(testData.mobileExists);
          const firstResult = page.getByRole('checkbox').first();
          test.skip(
            !(await firstResult.isVisible({ timeout: 15_000 }).catch(() => false)),
            'the directory returned no one for QA_MOBILE_EXISTS right now (live condition)',
          );
          await firstResult.check();
        });

        await test.step('A adds them as a contact', async () => {
          await page.getByRole('button', { name: 'Add To Contact' }).first().click();
          await page
            .getByRole('button', { name: 'Add', exact: true })
            .first()
            .click({ timeout: 8_000 })
            .catch(() => undefined);
          await page
            .waitForRequest('**/contacts/addContact**', { timeout: 15_000 })
            .catch(() => undefined);
          expect(addedId, 'the app sent addContact with the contact id').toBeTruthy();
        });

        await test.step('the contact is in the Contacts list (UNPROVEN STEP)', async () => {
          expect(await gotoContacts(page), 'the Contacts tab opens').toBe(true);
          await contactsSearchBox(page).fill(addedId!);
          await expect(
            page.getByText(addedId!, { exact: false }).first(),
            "the new contact is listed in A's Contacts",
          ).toBeVisible({ timeout: 20_000 });
        });

        await test.step('the contact is saved on the server', async () => {
          sessionUsedByApi = true;
          await expect
            .poll(
              async () => {
                const ex = await endpoints.sendTo(
                  'contacts-my-contacts',
                  { body: { lastfetchDate: null } },
                  { label: 'journey:contacts:verify', auth: { principal: A! } },
                );
                return ex.bodyText.toLowerCase().includes(String(addedId).toLowerCase());
              },
              { timeout: 15_000, message: "the added contact is in A's contacts on the server" },
            )
            .toBe(true);
        });
      } finally {
        if (addedId) {
          sessionUsedByApi = true;
          await endpoints
            .sendTo(
              'contacts-delete',
              { body: { contactID: addedId } },
              { label: 'journey:contacts:cleanup', auth: { principal: A! }, allowLiveWrite: true },
            )
            .catch(() => undefined);
        }
        if (sessionUsedByApi)
          await restoreSavedSession(page, testData.kpostId, testData.password, STORAGE_STATE);
      }
    });
  },
);
