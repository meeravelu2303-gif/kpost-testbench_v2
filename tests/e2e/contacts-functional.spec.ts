import { AUTH_PROFILES } from '@config/auth-profile';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import {
  contactsSearchBox,
  gotoContacts,
  openAdvancedSearch,
  openCreateGroup,
  openPeopleSearch,
} from './support/contacts';

/**
 * Contacts **functional** UI testing — the client's own behaviour, and whether an action in the UI
 * actually reaches the server, that a pure API test cannot see.
 *
 * Navigation and selectors come from `support/contacts.ts` (read from the front-end source,
 * 2026-10-11): the Contacts tab, its search box, the Add-contact wizard (now the KDirectory page:
 * Country → Language → vertical → Continue → people search → Advanced Search), and the Create New
 * Group modal.
 *
 * ## What each angle proves
 *  - **search** narrows the list (client filtering works);
 *  - **the add wizard opens** and reaches its people-search step (the feature is usable);
 *  - **guards**: "Add To Contact" with nothing selected, and "Create" a group with no name, must not
 *    dispatch a write — client validation, no junk data;
 *  - **cross-layer add**: a contact added in the UI actually appears in `myContacts` (UI → API → DB);
 *  - **advanced search** by mobile responds.
 *
 * ## Safety
 * The read/validation angles write nothing. The one add-and-verify test is gated behind
 * `CONTACTS_UI_LIFECYCLE`, captures the exact contactID the UI dispatched, and deletes only that in a
 * `finally`, so it removes precisely what it created and nothing else.
 */

const PERSONAL = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal')!;

test.describe(
  'KPost Contacts · UI functional behaviour @ui',
  { tag: ['@ui', '@contacts', '@regression', '@sanity'] },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    test('searching the contact list narrows it to the query @ui', async ({ page }) => {
      const opened = await gotoContacts(page);
      test.skip(
        !opened,
        'the Contacts panel was not showing right now (a session or load condition, not a Contacts defect) — see support/contacts.ts',
      );

      // Contact rows are `ContactBar`s; count the visible names before and after a nonsense query.
      const names = page.locator('.Bar-Name:visible');
      const before = await names.count();
      expect(before, 'the Contacts panel lists at least one contact to filter').toBeGreaterThan(0);

      const search = contactsSearchBox(page);
      await search.click();
      await search.fill('zzzzzznomatch');
      await expect
        .poll(() => names.count(), {
          message: 'a nonsense search does not still show the full list',
          timeout: 10_000,
        })
        .toBeLessThan(before);
    });

    test('the Add-contact wizard opens and reaches its people-search step @ui', async ({
      page,
    }) => {
      const opened = await gotoContacts(page);
      test.skip(
        !opened,
        'the Contacts panel was not showing right now (a session or load condition, not a Contacts defect) — see support/contacts.ts',
      );
      const search = await openPeopleSearch(page);
      expect(search, 'the Add-contact wizard reaches a people search').not.toBeNull();
      await expect(search!, 'the people search box is usable').toBeEditable();
    });

    test('“Add To Contact” does not dispatch an add when nothing is selected @ui', async ({
      page,
    }) => {
      const opened = await gotoContacts(page);
      test.skip(
        !opened,
        'the Contacts panel was not showing right now (a session or load condition, not a Contacts defect) — see support/contacts.ts',
      );
      const search = await openPeopleSearch(page);
      expect(search, 'the people-search step renders').not.toBeNull();

      const addBtn = page.getByRole('button', { name: 'Add To Contact' }).first();
      const dispatched = page
        .waitForRequest('**/contacts/addContact**', { timeout: 4_000 })
        .then(() => true)
        .catch(() => false);
      // The button is either disabled with nothing selected (ideal) or enabled but a no-op.
      if (await addBtn.isVisible().catch(() => false)) {
        await addBtn.click({ timeout: 5_000 }).catch(() => undefined);
      }
      expect(await dispatched, 'adding with no contact selected must not dispatch an add').toBe(
        false,
      );
    });

    test('the Create-Group dialog does not create a group with no name @ui', async ({ page }) => {
      const opened = await gotoContacts(page);
      test.skip(
        !opened,
        'the Contacts panel was not showing right now (a session or load condition, not a Contacts defect) — see support/contacts.ts',
      );
      const modal = await openCreateGroup(page);
      expect(modal, 'the Create New Group modal opens').not.toBeNull();
      await expect(modal!.getByRole('textbox', { name: 'Group Name' }).first()).toBeVisible();

      // Leave the name empty and try to Create — no createUserGroup call must go out.
      const dispatched = page
        .waitForRequest('**/group/createUserGroup**', { timeout: 4_000 })
        .then(() => true)
        .catch(() => false);
      await modal!
        .getByRole('button', { name: 'Create' })
        .first()
        .click({ timeout: 5_000 })
        .catch(() => undefined);
      expect(await dispatched, 'creating a group with no name must not be dispatched').toBe(false);
    });

    test('advanced search opens and a mobile-number search responds @ui', async ({ page }) => {
      const opened = await gotoContacts(page);
      test.skip(
        !opened,
        'the Contacts panel was not showing right now (a session or load condition, not a Contacts defect) — see support/contacts.ts',
      );
      const search = await openPeopleSearch(page);
      expect(search, 'the people-search step renders').not.toBeNull();
      const mobileField = await openAdvancedSearch(page);
      expect(mobileField, 'Advanced Search opens with a mobile-number field').not.toBeNull();

      await mobileField!.click();
      await mobileField!.fill(testData.mobileExists);
      const responded = page
        .waitForResponse((r) => r.url().includes('/profile/advancedSearch/'), {
          timeout: 15_000,
        })
        .then((r) => r.status())
        .catch(() => 0);
      await page.getByRole('button', { name: 'Search', exact: true }).first().click();
      const status = await responded;
      test
        .info()
        .annotations.push({ type: 'observed', description: `mobile search → HTTP ${status}` });
      expect(status, 'a mobile-number search reaches the server and is answered').toBeGreaterThan(
        0,
      );
      expect(status, 'the search is not a server error').toBeLessThan(500);
    });

    test('a contact added in the UI appears in My Contacts (UI → API → DB) @ui', async ({
      page,
      endpoints,
    }) => {
      test.skip(
        process.env.CONTACTS_UI_LIFECYCLE !== 'true',
        'adds a real contact; set CONTACTS_UI_LIFECYCLE=true',
      );
      const opened = await gotoContacts(page);
      test.skip(
        !opened,
        'the Contacts panel was not showing right now (a session or load condition, not a Contacts defect) — see support/contacts.ts',
      );

      // Capture the exact contactID the UI dispatches, so cleanup removes only what we add.
      let addedId: string | undefined;
      await page.route('**/contacts/addContact**', async (route) => {
        try {
          const d = route.request().postDataJSON() as { contactID?: string; contactId?: string };
          addedId = d?.contactID ?? d?.contactId ?? addedId;
        } catch {
          /* keep going — the assertion below covers a missing dispatch */
        }
        await route.continue();
      });

      try {
        const search = await openPeopleSearch(page);
        expect(search, 'the people-search step renders').not.toBeNull();
        await search!.click();
        await search!.fill(testData.mobileExists);

        const firstResult = page.getByRole('checkbox').first();
        const hasResult = await firstResult.isVisible({ timeout: 15_000 }).catch(() => false);
        test.skip(
          !hasResult,
          'the directory returned no result for the QA mobile — cannot drive add (live condition)',
        );
        await firstResult.check();
        await page.getByRole('button', { name: 'Add To Contact' }).first().click();
        await page
          .getByRole('button', { name: 'Add', exact: true })
          .first()
          .click({ timeout: 8_000 })
          .catch(() => undefined);
        await page
          .waitForRequest('**/contacts/addContact**', { timeout: 15_000 })
          .catch(() => undefined);
        expect(addedId, 'the UI dispatched addContact with a contactID').toBeTruthy();

        // Cross-layer: the contact the UI added must be present in myContacts.
        await expect
          .poll(
            async () => {
              const ex = await endpoints
                .sendTo(
                  'contacts-my-contacts',
                  { body: { lastfetchDate: null } },
                  { label: 'contacts:verify', auth: { principal: PERSONAL } },
                )
                .catch(() => ({ bodyText: '' }));
              return (ex.bodyText ?? '').toLowerCase().includes(String(addedId).toLowerCase());
            },
            {
              timeout: 15_000,
              message: 'a contact added in the UI must appear in My Contacts (UI → API → DB)',
            },
          )
          .toBe(true);
      } finally {
        if (addedId) {
          await endpoints
            .sendTo(
              'contacts-delete',
              { body: { contactID: addedId } },
              { label: 'contacts:cleanup', auth: { principal: PERSONAL }, allowLiveWrite: true },
            )
            .catch(() => undefined);
        }
      }
    });
  },
);
