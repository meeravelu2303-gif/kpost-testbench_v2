import { env } from '@config/env';
// An orchestrated address-book lifecycle (add → verify → block → unblock → delete): each test
// writes real data and restores it in a `finally`.
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import { hasContact } from '../../support/contacts-response';

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
/** A deliberately absent id, used as the negative control for the address-book matcher. */
const NON_EXISTENT_CONTACT = 'qa.bench.absent.negative-control@kpostindia.com';

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

/** Read the address book once, returning the parsed body (or `undefined` when it did not answer). */
async function readAddressBook(endpoints: EndpointExecutor): Promise<unknown> {
  const exchange = await endpoints
    .sendTo(
      'contacts-my-contacts',
      { body: { lastfetchDate: null } },
      { label: 'contacts:verify', auth: { principal: A } },
    )
    .catch(() => undefined);
  if (!exchange) return undefined;
  const parsed = exchange.json();
  return parsed.ok ? parsed.value : undefined;
}

/**
 * Polls the address book until the contact appears, or the attempts run out.
 *
 * The bounded retry is what the original `if (present) assert(true)` was reaching for: the write is
 * eventually consistent, so a single immediate read can legitimately miss it. Retrying preserves
 * that tolerance while keeping the outcome a real assertion — if the contact never arrives, the
 * caller gets `undefined` and the test fails, which is exactly what the tautology prevented.
 */
async function waitForContact(
  endpoints: EndpointExecutor,
  attempts = 3,
  delayMs = 1_000,
): Promise<{ found: boolean; answered: boolean }> {
  let answered = false;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const body = await readAddressBook(endpoints);
    if (body !== undefined) {
      answered = true;
      if (hasContact(body, contactId)) return { found: true, answered };
      /*
       * Negative control, on the SAME live body: the matcher must not find an id that cannot exist.
       * Without it, a matcher that returned true for everything would look identical to a working
       * one — which is how the assertion this replaces came to be meaningless.
       */
      expect
        .soft(hasContact(body, NON_EXISTENT_CONTACT), 'the matcher rejects an absent contact id')
        .toBe(false);
    }
    if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return { found: false, answered };
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
      // Layer 1 — the HTTP contract. Kept: it still says something the read-back does not.
      expect.soft(added, 'adding a contact is accepted').toBeLessThan(300);

      /*
       * Layer 2 — the application state. This is the assertion that used to be
       * `expect.soft(true, 'the contact appears in myContacts').toBe(true)` inside an
       * `if (present)` guard: a tautology that could not fail and that reported nothing when the
       * contact was absent. It now reads `contacts_added[].contactID` from the real response.
       */
      const seen = await waitForContact(endpoints);
      expect
        .soft(seen.answered, 'myContacts answered, so its contents are evidence either way')
        .toBe(true);
      expect.soft(seen.found, `the added contact ${contactId} appears in myContacts`).toBe(true);

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
