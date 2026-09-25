import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Contacts **list data-quality and block-cycle business rules**.
 *
 * The four reads below (`myUnknownContacts`, `myGroups`, `myUnknownGroups`, `getImportedPhoneContacts`)
 * are `productionSafe: true` and never gated — real ownership/duplicate checks that don't depend on
 * this run's own writes. The block/unblock cycle IS a write, gated behind `CONTACTS_LIFECYCLE=true`
 * like the module's existing `feature.spec.ts`; it targets our own second account and restores it.
 *
 * `myContacts`'s own persistence after `deleteContact` is NOT re-tested here — that exact failure
 * mode (delete reports success but leaves the row live) is already covered, against the raw DB flag,
 * by `contacts-workflow.spec.ts`. A list-membership check here would just rediscover the same known
 * issue less precisely.
 */
const A: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal')!;
const contactId = testData.victimKpostId;

test.describe('KPost Contacts · list data-quality @api @kpost-api @contacts', () => {
  test('myUnknownKatchupContacts rows all belong to the caller, with no duplicates', async ({
    endpoints,
  }) => {
    const ex = await endpoints.sendTo(
      'contacts-my-unknown-contacts',
      { body: { lastfetchDate: null } },
      { label: 'contacts-consistency:unknown-contacts', auth: { principal: A } },
    );
    expect(ex.status, 'myUnknownKatchupContacts succeeds').toBe(200);
    const body = JSON.parse(ex.bodyText || '{}') as {
      unknown_contact_added?: Array<{ kpostID?: string; contactID?: string }>;
    };
    const rows = body.unknown_contact_added ?? [];
    for (const row of rows) {
      expect(
        row.kpostID?.toLowerCase(),
        "every row's kpostID is the caller's own account",
      ).toBe(testData.kpostId.toLowerCase());
    }
    const contactIds = rows.map((r) => r.contactID);
    expect(contactIds, 'no duplicate counterparties in the unknown-contacts list').toHaveLength(
      new Set(contactIds).size,
    );
  });

  test('myGroups and myUnknownGroups each carry no duplicate group', async ({ endpoints }) => {
    const [groups, unknownGroups] = await Promise.all([
      endpoints.sendTo(
        'contacts-my-groups',
        { body: { lastfetchDate: null } },
        { label: 'contacts-consistency:groups', auth: { principal: A } },
      ),
      endpoints.sendTo(
        'contacts-my-unknown-groups',
        { body: { lastfetchDate: null } },
        { label: 'contacts-consistency:unknown-groups', auth: { principal: A } },
      ),
    ]);
    expect(groups.status, 'myGroups succeeds').toBe(200);
    expect(unknownGroups.status, 'myUnknownGroups succeeds').toBe(200);

    const groupIds = (
      (JSON.parse(groups.bodyText || '{}') as { group_added?: Array<{ groupID?: number }> })
        .group_added ?? []
    ).map((r) => r.groupID);
    const unknownGroupIds = (
      (
        JSON.parse(unknownGroups.bodyText || '{}') as {
          unknown_group_added?: Array<{ groupID?: number }>;
        }
      ).unknown_group_added ?? []
    ).map((r) => r.groupID);

    expect(groupIds, 'no duplicate groups in myGroups').toHaveLength(new Set(groupIds).size);
    expect(unknownGroupIds, 'no duplicate groups in myUnknownGroups').toHaveLength(
      new Set(unknownGroupIds).size,
    );
  });

  test('getImportedPhoneContacts belongs to the caller, with no duplicate numbers', async ({
    endpoints,
  }) => {
    const ex = await endpoints.sendTo(
      'contacts-imported-phone',
      {},
      { label: 'contacts-consistency:imported-phone', auth: { principal: A } },
    );
    expect(ex.status, 'getImportedPhoneContacts succeeds').toBe(200);
    const body = JSON.parse(ex.bodyText || '{}') as {
      data?: { kpostID?: string; phoneContacts?: Array<{ mobileNumber?: string }> };
    };
    expect(body.data?.kpostID?.toLowerCase(), 'the list belongs to the caller').toBe(
      testData.kpostId.toLowerCase(),
    );
    const numbers = (body.data?.phoneContacts ?? []).map((r) => r.mobileNumber);
    expect(numbers, 'no duplicate imported numbers').toHaveLength(new Set(numbers).size);
  });

  test('blocking a contact makes it appear in getBlockContactDetails, unblocking removes it', async ({
    endpoints,
  }) => {
    test.skip(
      process.env.CONTACTS_LIFECYCLE !== 'true',
      'writes the block state; set CONTACTS_LIFECYCLE=true',
    );
    async function isBlocked(): Promise<boolean> {
      const ex = await endpoints.sendTo(
        'contacts-blocked',
        {},
        { label: 'contacts-consistency:blocked-list', auth: { principal: A } },
      );
      const body = JSON.parse(ex.bodyText || '{}') as { data?: string[] };
      return (body.data ?? []).some((id) => id.toLowerCase() === contactId.toLowerCase());
    }

    try {
      const block = await endpoints.sendTo(
        'contacts-block',
        { body: { contactID: contactId, isBlocked: true } },
        { label: 'contacts-consistency:block', auth: { principal: A }, allowLiveWrite: true },
      );
      expect(block.status, 'blocking is accepted').toBeLessThan(300);
      expect(await isBlocked(), 'the blocked contact now appears in getBlockContactDetails').toBe(
        true,
      );
    } finally {
      const unblock = await endpoints.sendTo(
        'contacts-block',
        { body: { contactID: contactId, isBlocked: false } },
        { label: 'contacts-consistency:unblock', auth: { principal: A }, allowLiveWrite: true },
      );
      expect(unblock.status, 'unblocking is accepted').toBeLessThan(300);
      expect(
        await isBlocked(),
        'the unblocked contact no longer appears in getBlockContactDetails',
      ).toBe(false);
    }
  });
});
