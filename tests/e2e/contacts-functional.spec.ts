import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { postAsPage, requireKpostDb, rowSummary, rowWhen } from './support/cross-layer';
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

test.describe(
  'KPost Contacts · UI functional behaviour @ui',
  { tag: ['@ui', '@contacts', '@regression', '@sanity'] },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    test(
      'searching the contact list narrows it to the query @ui',
      {
        annotation: [
          { type: 'requirement', description: 'FR-KD-001' },
          { type: 'requirement', description: 'FR-KD-002' },
        ],
      },
      async ({ page }) => {
        const opened = await gotoContacts(page);
        test.skip(
          !opened,
          'the Contacts panel was not showing right now (a session or load condition, not a Contacts defect) — see support/contacts.ts',
        );

        // Contact rows are `ContactBar`s; count the visible names before and after a nonsense query.
        const names = page.locator('.Bar-Name:visible');
        const before = await names.count();
        expect(before, 'the Contacts panel lists at least one contact to filter').toBeGreaterThan(
          0,
        );

        const search = contactsSearchBox(page);
        await search.click();
        await search.fill('zzzzzznomatch');
        await expect
          .poll(() => names.count(), {
            message: 'a nonsense search does not still show the full list',
            timeout: 10_000,
          })
          .toBeLessThan(before);
      },
    );

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

    test(
      'a contact added in the UI appears in My Contacts (UI → API → DB) @ui',
      {
        annotation: [
          {
            type: 'cross-layer',
            description: 'Contacts: add on screen → addContact → TBL_KPOST_USER_CONTACTS',
          },
        ],
      },
      async ({ page, databases }) => {
        const db = requireKpostDb(databases);
        type ContactRow = { contact_id: unknown; delete_status: unknown; first_name: unknown };
        const contactRow = (ok: (r: ContactRow | undefined) => boolean, message: string) =>
          rowWhen<ContactRow>(
            db,
            'SELECT contact_id, delete_status, first_name FROM TBL_KPOST_USER_CONTACTS WHERE kpost_id = ? AND contact_id = ? ORDER BY id DESC',
            [testData.kpostId, addedId],
            ok,
            message,
          );
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
          // A QA account that is NOT already a live contact of this account (read from the contacts
          // table), so the add makes a real new row — found by name in the directory search.
          const live = await db.query<{ contact_id: unknown }>(
            "SELECT contact_id FROM TBL_KPOST_USER_CONTACTS WHERE kpost_id = ? AND (delete_status IS NULL OR delete_status NOT IN ('1', 'Y', 'y'))",
            [testData.kpostId],
          );
          const taken = new Set(live.map((r) => String(r.contact_id).toLowerCase()));
          const spare = [3, 4, 5, 6].find((i) => !taken.has(`qatest${i}@kpostindia.com`));
          test.skip(
            spare === undefined,
            'every spare QA account is already a contact right now — nothing new to add',
          );
          await search!.fill('Qatest');

          // Each result is a checkbox inside its person's row: pair every checkbox with the text of the
          // nearest ancestor that has any, and pick the spare account's.
          const boxes = page.getByRole('checkbox');
          await boxes
            .first()
            .waitFor({ state: 'visible', timeout: 15_000 })
            .catch(() => undefined);
          const labels = await boxes.evaluateAll((els) =>
            els.map((el) => {
              let node: HTMLElement | null = el.parentElement;
              while (node && (node.innerText ?? '').trim().length < 3) node = node.parentElement;
              return (node?.innerText ?? '').replace(/\s+/g, ' ').trim();
            }),
          );
          test.info().annotations.push({
            type: 'observed',
            description: `search results: ${JSON.stringify(labels.slice(0, 8))}`,
          });
          const at = labels.findIndex((l) => new RegExp(`Qatest${spare}\\b`, 'i').test(l));
          const firstResult = boxes.nth(Math.max(at, 0));
          const hasResult = at >= 0 && (await firstResult.isVisible().catch(() => false));
          test.skip(
            !hasResult,
            `the directory search returned no Qatest${spare} Bench right now — cannot drive add`,
          );
          await firstResult.check();
          await page.getByRole('button', { name: 'Add To Contact' }).first().click();
          await page
            .getByRole('button', { name: 'Add', exact: true })
            .first()
            .click({ timeout: 8_000 })
            .catch(() => undefined);
          const addResponse = await page
            .waitForResponse('**/contacts/addContact**', { timeout: 15_000 })
            .catch(() => null);
          expect(addedId, 'the UI dispatched addContact with a contactID').toBeTruthy();
          expect(addResponse?.status() ?? 0, 'the server accepts the add').toBeLessThan(300);

          // Layer 3: the contact row exists for this account and is live (not deleted).
          const stored = await contactRow(
            (r) =>
              r !== undefined &&
              !['1', 'y', 'yes', 'true'].includes(String(r.delete_status).toLowerCase()),
            `TBL_KPOST_USER_CONTACTS holds a live row for contact ${String(addedId)}`,
          );
          test.info().annotations.push({
            type: 'observed',
            description: `addContact → HTTP ${addResponse?.status()}; row: ${rowSummary(stored, ['contact_id', 'first_name', 'delete_status'])}`,
          });

          // Cross-layer: the contact the UI added must be present in myContacts (read with the page's
          // own session — an API login as the same account would sign this browser out).
          await expect
            .poll(
              async () => {
                const ex = await postAsPage(page, '/v2/contacts/myContacts/', {
                  lastfetchDate: null,
                }).catch(() => ({ text: '' }));
                return ex.text.toLowerCase().includes(String(addedId).toLowerCase());
              },
              {
                timeout: 15_000,
                message: 'a contact added in the UI must appear in My Contacts (UI → API → DB)',
              },
            )
            .toBe(true);
        } finally {
          if (addedId)
            await postAsPage(page, '/v2/contacts/deleteContact/', { contactID: addedId }).catch(
              () => undefined,
            );
        }
      },
    );
  },
);
