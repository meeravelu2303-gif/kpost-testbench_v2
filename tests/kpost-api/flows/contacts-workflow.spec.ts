import { contactShape } from '@api/definitions/kpost/contacts/write.api';
import { kpostDb, text } from '@database/kpost-assertions';
import { KpostRepository } from '@database/repositories/kpost.repository';
import { requireAll } from '@fixtures/test-accounts';
import { expect, test } from '@fixtures';
import { flowState } from '../../support/flow-state';

/**
 * Contacts: add → delete, asserted against the TBL_KPOST_USER_CONTACTS row (these endpoints answer
 * success regardless). Rows are stored once per direction, so the counterparty's row must stay untouched.
 * Writes only to our own address book and restores it in `afterAll`.
 */
test.describe(
  'KPost Contacts · relationship workflow @api @kpost-api @contacts @database',
  { tag: ['@api', '@contacts', '@regression'] },
  () => {
    // In order, but a failed step never skips the others.
    test.describe.configure({ mode: 'default' });

    const accounts = requireAll('primary', 'counterparty');
    test.skip(!accounts.ok, accounts.ok ? '' : accounts.reason);

    const me = (): string => (accounts.ok ? (accounts.accounts[0]?.kpostId ?? '') : '');
    const them = (): string => (accounts.ok ? (accounts.accounts[1]?.kpostId ?? '') : '');

    /** The counterparty's own row, captured so we can prove our writes never touched it. */
    const flow = flowState<{
      theirRowBefore: { delete_status: number | null; is_blocked: number | null };
    }>('contacts-workflow');

    test.afterAll(async ({ endpoints }) => {
      // Restore: put the contact back, so the suite leaves the address book as it found it.
      if (!accounts.ok) return;
      await endpoints
        .sendTo(
          'contacts-add',
          { body: contactShape({ contactID: them() }) },
          { label: 'contacts-workflow:restore', allowLiveWrite: true },
        )
        .catch(() => undefined);
    });

    test('the relationship is stored per direction, and both directions are visible', async ({
      databases,
    }) => {
      const database = databases.for('kpost-api');
      test.skip(!database.enabled, 'needs the KPOST_QA connection');

      const repo = new KpostRepository(database);
      const mine = await repo.contact(me(), them());
      const theirs = await repo.contact(them(), me());

      // Either direction may be missing; what matters is that the two are looked up separately.
      expect(mine ?? theirs, 'at least one direction of the relationship exists').toBeDefined();
      if (mine) expect(text(mine.kpost_id), 'my row is keyed by me').toBe(me());
      if (theirs) expect(text(theirs.contact_id), 'their row points back at me').toBe(me());

      if (theirs)
        flow.set('theirRowBefore', {
          delete_status: Number(theirs.delete_status ?? 0),
          is_blocked: Number(theirs.is_blocked ?? 0),
        });
    });

    test('adding a contact creates or revives my row, and leaves theirs alone', async ({
      endpoints,
      databases,
    }) => {
      const database = databases.for('kpost-api');
      test.skip(!database.enabled, 'needs the KPOST_QA connection');

      const exchange = await endpoints.sendTo(
        'contacts-add',
        { body: contactShape({ contactID: them() }) },
        { label: 'contacts-workflow:add', allowLiveWrite: true },
      );

      // Accepted or "Already" (statusCode 500, see #494) are both fine: `afterAll` restores the
      // contact, so a re-run finds it. The row's end state below is what counts.
      const parsed = exchange.json();
      const envelope = parsed.ok ? (parsed.value as { statusCode?: number; status?: string }) : {};
      const alreadyPresent = /already/i.test(
        `${envelope.status ?? ''} ${exchange.bodyText.slice(0, 120)}`,
      );
      expect(
        (envelope.statusCode ?? exchange.status) < 300 || alreadyPresent,
        `add neither succeeded nor reported the contact already present (body: ${exchange.bodyText.slice(0, 160)})`,
      ).toBe(true);

      const repo = new KpostRepository(database);
      const mine = await repo.contact(me(), them());

      expect(mine, 'my address book now holds a row for them').toBeDefined();
      // Added means not deleted — the flag is the whole state of "is this contact in my book".
      const deleteCheck = kpostDb.deleteStatus(mine, false);
      expect(deleteCheck.status, `${deleteCheck.name}: got ${String(deleteCheck.actual)}`).toBe(
        'PASSED',
      );

      // Their side is none of our business, and must be untouched.
      const theirs = await repo.contact(them(), me());
      const theirRowBefore = flow.get('theirRowBefore');
      if (theirRowBefore && theirs) {
        expect(
          Number(theirs.delete_status ?? 0),
          'adding them to MY book must not change THEIR row',
        ).toBe(theirRowBefore.delete_status);
      }
    });

    test('deleting is a soft delete: my flag flips, their row survives', async ({
      endpoints,
      databases,
    }) => {
      const database = databases.for('kpost-api');
      test.skip(!database.enabled, 'needs the KPOST_QA connection');

      const exchange = await endpoints.sendTo(
        'contacts-delete',
        { body: { contactID: them() } },
        { label: 'contacts-workflow:delete', allowLiveWrite: true },
      );
      const parsed = exchange.json();
      const envelope = parsed.ok ? (parsed.value as { statusCode?: number }) : {};
      expect(
        envelope.statusCode ?? exchange.status,
        `delete reported failure (body: ${exchange.bodyText.slice(0, 160)})`,
      ).toBeLessThan(300);

      const repo = new KpostRepository(database);
      const mine = await repo.contact(me(), them());

      // The row must still exist: a hard delete looks identical on the wire.
      expect(mine, 'a soft delete leaves the row in place').toBeDefined();
      const deleted = kpostDb.deleteStatus(mine, true);
      expect(deleted.status, `${deleted.name}: got ${String(deleted.actual)}`).toBe('PASSED');

      const theirs = await repo.contact(them(), me());
      const theirRowBefore = flow.get('theirRowBefore');
      if (theirRowBefore && theirs) {
        expect(
          Number(theirs.delete_status ?? 0),
          'removing them from MY book must not remove me from THEIRS',
        ).toBe(theirRowBefore.delete_status);
      }
    });
  },
);

/**
 * Block/unblock, judged by the is_blocked flag (the response says success regardless). Separate
 * describe so it always starts from "contact exists, unblocked".
 */
test.describe(
  'KPost Contacts · block @api @kpost-api @contacts @database',
  { tag: ['@api', '@contacts', '@regression'] },
  () => {
    const accounts = requireAll('primary', 'counterparty');
    test.skip(!accounts.ok, accounts.ok ? '' : accounts.reason);

    const me = (): string => (accounts.ok ? (accounts.accounts[0]?.kpostId ?? '') : '');
    const them = (): string => (accounts.ok ? (accounts.accounts[1]?.kpostId ?? '') : '');

    test('blocking sets is_blocked, unblocking clears it, their row survives', async ({
      endpoints,
      databases,
    }) => {
      const database = databases.for('kpost-api');
      test.skip(!database.enabled, 'needs the KPOST_QA connection');

      // Ensure the contact exists first — this describe doesn't depend on the add/delete suite's state.
      await endpoints
        .sendTo(
          'contacts-add',
          { body: contactShape({ contactID: them() }) },
          { label: 'contacts-workflow:block-setup-add', allowLiveWrite: true },
        )
        .catch(() => undefined);

      const repo = new KpostRepository(database);
      const theirRowBefore = await repo.contact(them(), me());

      const block = await endpoints.sendTo(
        'contacts-block',
        { body: { contactID: them(), isBlocked: true } },
        { label: 'contacts-workflow:block', allowLiveWrite: true },
      );
      const blockEnvelope = block.json();
      const blockStatus = blockEnvelope.ok
        ? ((blockEnvelope.value as { statusCode?: number }).statusCode ?? block.status)
        : block.status;
      expect
        .soft(blockStatus, `block reported failure (body: ${block.bodyText.slice(0, 160)})`)
        .toBeLessThan(300);

      const blocked = await repo.contact(me(), them());
      const blockedCheck = kpostDb.isBlocked(blocked, true);
      expect
        .soft(blockedCheck.status, `${blockedCheck.name}: got ${String(blockedCheck.actual)}`)
        .toBe('PASSED');

      const theirsAfterBlock = await repo.contact(them(), me());
      if (theirRowBefore && theirsAfterBlock) {
        expect
          .soft(
            Number(theirsAfterBlock.is_blocked ?? 0),
            'blocking them in MY book must not block me in THEIRS',
          )
          .toBe(Number(theirRowBefore.is_blocked ?? 0));
      }

      const unblock = await endpoints.sendTo(
        'contacts-block',
        { body: { contactID: them(), isBlocked: false } },
        { label: 'contacts-workflow:unblock', allowLiveWrite: true },
      );
      const unblockEnvelope = unblock.json();
      const unblockStatus = unblockEnvelope.ok
        ? ((unblockEnvelope.value as { statusCode?: number }).statusCode ?? unblock.status)
        : unblock.status;
      expect
        .soft(unblockStatus, `unblock reported failure (body: ${unblock.bodyText.slice(0, 160)})`)
        .toBeLessThan(300);

      const unblocked = await repo.contact(me(), them());
      const unblockedCheck = kpostDb.isBlocked(unblocked, false);
      expect
        .soft(unblockedCheck.status, `${unblockedCheck.name}: got ${String(unblockedCheck.actual)}`)
        .toBe('PASSED');
    });
  },
);
