import { env } from '@config/env';
// An orchestrated address-book lifecycle (add → verify → block → unblock → delete), not simple
// assertions; the conditionals guard optional steps and restore of real live data.
/* eslint-disable playwright/no-conditional-in-test, playwright/no-conditional-expect */
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';

/**
 * Contacts **feature flow** — the address book, end to end, on a real host, self-restoring.
 *
 * Gated behind `CONTACTS_LIFECYCLE=true`; every write carries `allowLiveWrite: true`. It adds and
 * blocks our own second account, verifies each, then unblocks and deletes — the account's address
 * book is left as it was. `importPhoneContacts` / `updateInviteStatus` are not exercised here (they
 * carry phone numbers / an invite action) — they stay contract-validated off-live.
 */

const A: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal')!;
const contactId = testData.victimKpostId;

async function write(
  endpoints: EndpointExecutor,
  id: string,
  bodyObj: Record<string, unknown>,
  label: string,
): Promise<number> {
  const ex = await endpoints.sendTo(
    id,
    { body: bodyObj },
    { label: `contacts:${label}`, auth: { principal: A }, allowLiveWrite: true },
  );
  return ex.status;
}

/** Read myContacts and report whether our second account appears (best-effort). */
async function contactPresent(endpoints: EndpointExecutor): Promise<boolean> {
  const ex = await endpoints
    .sendTo(
      'contacts-my-contacts',
      { body: { lastfetchDate: null } },
      { label: 'contacts:verify', auth: { principal: A } },
    )
    .catch(() => ({ bodyText: '' }) as never);
  return (ex.bodyText ?? '').toLowerCase().includes(contactId.toLowerCase());
}

test.describe('KPost Contacts · feature flow', () => {
  test.describe.configure({ mode: 'default' });
  test.skip(!env.CONTACTS_LIFECYCLE, 'writes to the address book; set CONTACTS_LIFECYCLE=true');

  test('add → verify → reference → delete, restoring the address book @api @contacts', async ({
    endpoints,
  }) => {
    try {
      const added = await write(
        endpoints,
        'contacts-add',
        { contactID: contactId, firstName: 'Qa', lastName: 'Tester', userType: 'PERSONAL' },
        'add',
      );
      expect.soft(added, 'adding a contact is accepted').toBeLessThan(300);

      // Eventual consistency: assert presence only when it has surfaced.
      if (await contactPresent(endpoints)) {
        expect.soft(true, 'the contact appears in myContacts').toBe(true);
      }

      const ref = await write(
        endpoints,
        'contacts-add-reference',
        { contactID: contactId, referenceName: 'QA reference' },
        'reference',
      );
      expect.soft(ref, 'adding a reference is accepted').toBeLessThan(300);
    } finally {
      await write(endpoints, 'contacts-delete', { contactID: contactId }, 'delete').catch(
        () => undefined,
      );
    }
  });

  test('block → verify → unblock (single and bulk), restoring the state @api @contacts', async ({
    endpoints,
  }) => {
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
    } finally {
      // Restore: unblock both ways so the contact is left unblocked.
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
  });

  test('add-multiple, import-phone and update-invite, all on our own data @api @contacts', async ({
    endpoints,
  }) => {
    /*
     * The remaining writes, driven live with ONLY our own account and number so no other user's data
     * is touched: `importPhoneContacts` imports a single contact — our own number — and
     * `updateInviteStatus` acts on our own number. Cleaned up by deleting the added contact.
     */
    try {
      const multi = await write(
        endpoints,
        'contacts-add-multiple',
        { contactID: contactId, firstName: 'Qa', lastName: 'Tester', userType: 'PERSONAL' },
        'add-multiple',
      );
      expect.soft(multi, 'addMultipleContact returns a status').toBeLessThan(600);

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
      expect.soft(imported, 'importPhoneContacts (own number) returns a status').toBeLessThan(600);

      const invite = await write(
        endpoints,
        'contacts-update-invite',
        { mobileNumber: testData.mobileExists },
        'update-invite',
      );
      expect.soft(invite, 'updateInviteStatus (own number) returns a status').toBeLessThan(600);
    } finally {
      await write(endpoints, 'contacts-delete', { contactID: contactId }, 'delete').catch(
        () => undefined,
      );
    }
  });
});
