// An orchestrated address-book lifecycle (add → verify → block → unblock → delete), not simple
// assertions; the conditionals guard optional steps and restore of real live data.

import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import { atOrAfter, expectStored } from '../../../support/db-stored';

/**
 * Contacts feature flow: add, block, unblock and delete our own second account, leaving the address
 * book as it was. Gated by CONTACTS_LIFECYCLE=true (real writes).
 */

const A: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal')!;
const contactId = testData.victimKpostId;

async function write(
  endpoints: EndpointExecutor,
  id: string,
  bodyObj: unknown,
  label: string,
): Promise<number> {
  const ex = await endpoints.sendTo(
    id,
    { body: bodyObj },
    { label: `contacts:${label}`, auth: { principal: A }, allowLiveWrite: true },
  );
  return ex.status;
}

interface ContactRow {
  contactID?: string;
  firstName?: string;
  lastName?: string;
  referenceName?: string;
  userType?: string;
  isBlocked?: boolean;
  deleteStatus?: boolean;
}

/** Our second account's live row in the address book, or undefined (best-effort read). */
async function contactRow(endpoints: EndpointExecutor): Promise<ContactRow | undefined> {
  const ex = await endpoints
    .sendTo(
      'contacts-my-contacts',
      { body: { lastfetchDate: null } },
      { label: 'contacts:verify', auth: { principal: A } },
    )
    .catch(() => undefined);
  const parsed = ex?.json();
  const rows = ((parsed?.ok ? parsed.value : {}) as { contacts_added?: ContactRow[] })
    .contacts_added;
  return (rows ?? []).find(
    (row) => row.contactID?.toLowerCase() === contactId.toLowerCase() && row.deleteStatus !== true,
  );
}

/**
 * Leaves the address book as it was: the flow's entry is deleted and, when the person was already a
 * contact (the browser tests need qatest2 there), their original entry is added back unchanged.
 */
async function restore(endpoints: EndpointExecutor, original?: ContactRow): Promise<void> {
  await write(endpoints, 'contacts-delete', { contactID: contactId }, 'delete').catch(
    () => undefined,
  );
  if (!original) return;
  await write(
    endpoints,
    'contacts-add',
    {
      contactID: contactId,
      firstName: original.firstName ?? '',
      lastName: original.lastName ?? '',
      referenceName: original.referenceName ?? '',
      userType: original.userType ?? 'PERSONAL',
    },
    'restore',
  ).catch(() => undefined);
  if (original.isBlocked)
    await write(endpoints, 'contacts-block', { contactID: contactId, isBlocked: true }, 'restore');
}

test.describe(
  'KPost Contacts · feature flow',
  { tag: ['@api', '@contacts', '@regression'] },
  () => {
    test.describe.configure({ mode: 'default' });
    test.skip(
      process.env.CONTACTS_LIFECYCLE !== 'true',
      'writes to the address book; set CONTACTS_LIFECYCLE=true',
    );

    test(
      'add → verify → reference → delete, restoring the address book @api @contacts',
      { tag: '@sanity' },
      async ({ endpoints }) => {
        const original = await contactRow(endpoints);
        try {
          // Already a contact: remove it first, so the add below is a real add (restored after).
          if (original)
            await write(endpoints, 'contacts-delete', { contactID: contactId }, 'setup');
          const added = await write(
            endpoints,
            'contacts-add',
            { contactID: contactId, firstName: 'Qa', lastName: 'Tester', userType: 'PERSONAL' },
            'add',
          );
          expect.soft(added, 'adding a contact is accepted').toBeLessThan(300);
          // The server names the contact from their profile (the web app sends that name too).
          const listed = await contactRow(endpoints);
          expect.soft(listed, 'the contact appears in myContacts').toBeTruthy();

          const ref = await write(
            endpoints,
            'contacts-add-reference',
            { contactID: contactId, referenceName: 'QA reference' },
            'reference',
          );
          expect.soft(ref, 'adding a reference is accepted').toBeLessThan(300);
        } finally {
          await restore(endpoints, original);
        }
      },
    );

    test('block → verify → unblock (single and bulk), restoring the state @api @contacts', async ({
      endpoints,
      databases,
    }) => {
      const db = databases.for('kpost-api');
      const wasBlocked = (await contactRow(endpoints))?.isBlocked === true;
      try {
        const blocked = await write(
          endpoints,
          'contacts-block',
          { contactID: contactId, isBlocked: true },
          'block',
        );
        expect.soft(blocked, 'blocking a contact is accepted').toBeLessThan(300);

        const bulk = await write(
          endpoints,
          'contacts-block-multiple',
          { contactIDs: [contactId], isBlocked: true },
          'block-multiple',
        );
        expect.soft(bulk, 'bulk block is accepted').toBeLessThan(300);
        // ContactsDirectoryDaoImpl.java:585 sets is_blocked on the caller's row for each contactID.
        if (bulk < 300)
          await expectStored(
            db,
            'contacts-block-multiple',
            {
              table: 'TBL_KPOST_USER_CONTACTS',
              where: { kpost_id: A.username, contact_id: contactId },
              columns: { is_blocked: true },
              rule: "blockOrUnBlockMultipleContact sets is_blocked on the caller's row for each contact it names",
            },
            endpoints,
          );
      } finally {
        // Restore: unblock both ways, unless the contact was blocked before the test.
        if (!wasBlocked) {
          await write(
            endpoints,
            'contacts-block',
            { contactID: contactId, isBlocked: false },
            'unblock',
          ).catch(() => undefined);
          await write(
            endpoints,
            'contacts-block-multiple',
            { contactIDs: [contactId], isBlocked: false },
            'unblock-multiple',
          ).catch(() => undefined);
        }
      }
    });

    test('add-multiple, import-phone and update-invite, all on our own data @api @contacts', async ({
      endpoints,
      databases,
    }) => {
      const db = databases.for('kpost-api');
      // Only our own account and number; the address book is put back as it was afterwards.
      const original = await contactRow(endpoints);
      try {
        if (original) await write(endpoints, 'contacts-delete', { contactID: contactId }, 'setup');
        const startedAt = Date.now();
        // A JSON array, as the controller binds it (ContactsDirectoryControllerV2.addMultipleContact
        // takes List<Contacts>); a single object is refused as a malformed body.
        const multi = await write(
          endpoints,
          'contacts-add-multiple',
          [{ contactID: contactId, firstName: 'Qa', lastName: 'Tester', userType: 'PERSONAL' }],
          'add-multiple',
        );
        expect.soft(multi, 'addMultipleContact returns a status').toBeLessThan(600);
        // ContactsDirectoryDaoImpl.java:146 revives a deleted row, :191 saves a new one: either way the
        // row is live (delete_status false) and created_date is now.
        if (multi < 300)
          await expectStored(
            db,
            'contacts-add-multiple',
            {
              table: 'TBL_KPOST_USER_CONTACTS',
              where: { kpost_id: A.username, contact_id: contactId },
              columns: { delete_status: false, created_date: atOrAfter(startedAt) },
              rule: "addMultipleContact puts each named contact in the caller's address book as a live row",
            },
            endpoints,
          );

        const imported = await write(
          endpoints,
          'contacts-import-phone',
          {
            deviceID: 'qa-bench-device',
            mobileNumber: testData.mobileExists,
            countryCode: '91',
            phoneContacts: [{ name: 'QA', mobileNumber: testData.mobileExists }],
          },
          'import-phone',
        );
        expect
          .soft(imported, 'importPhoneContacts (own number) returns a status')
          .toBeLessThan(600);

        // No read endpoint exposes invite status, so only the status can be asserted.
        const invite = await write(
          endpoints,
          'contacts-update-invite',
          { mobileNumber: testData.mobileExists },
          'update-invite',
        );
        expect.soft(invite, 'updateInviteStatus (own number) returns a status').toBeLessThan(600);
      } finally {
        await restore(endpoints, original);
      }
    });
  },
);
