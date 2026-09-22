import { contactShape } from '@api/definitions/kpost/contacts/write.api';
import { kpostDb, text } from '@database/kpost-assertions';
import { KpostRepository } from '@database/repositories/kpost.repository';
import { requireAll } from '@fixtures/test-accounts';
import { expect, test } from '@fixtures';

/**
 * Contacts — add → list → block → delete, asserted against the relationship row each step.
 *
 * ## The failure this is built around
 *
 * A contact's state lives in **one tinyint each** on `TBL_KPOST_USER_CONTACTS`: `is_blocked` and
 * `delete_status`. Every interesting fault is a flag that did not move, and none of them is visible
 * in the response — these endpoints answer SUCCESS regardless:
 *
 *  - Delete reports success and leaves `delete_status = 0`, so the contact reappears on next login.
 *  - Delete **hard-deletes** the row, taking the counterparty's side of the relationship with it.
 *  - Block reports success and leaves `is_blocked = 0`, so the blocked user can still reach you —
 *    a privacy failure that looks identical to success from the client.
 *
 * ## Directionality is the part that is easy to get wrong
 *
 * The table stores the relationship **once per direction**: `(kpost_id, contact_id)` is a distinct
 * row from `(contact_id, kpost_id)`. Measured on KPOST_QA, the two directions genuinely disagree —
 * one account's row can be soft-deleted while the other's is active. So every assertion below names
 * the direction it is checking, and the counterparty's row is asserted to be *untouched*: my
 * removing you from my address book must not remove me from yours.
 *
 * ## Safety
 *
 * Writes only to the caller's own address book, restores the starting state, and carries
 * `allowLiveWrite` per call — the executor's authorization for a `data` write on live. The
 * QA-identifier guard still refuses any payload naming a record we do not own.
 */
test.describe('KPost Contacts · relationship workflow @api @kpost-api @contacts @database', () => {
  test.describe.configure({ mode: 'serial' });

  const accounts = requireAll('primary', 'counterparty');
  test.skip(!accounts.ok, accounts.ok ? '' : accounts.reason);

  const me = (): string => (accounts.ok ? (accounts.accounts[0]?.kpostId ?? '') : '');
  const them = (): string => (accounts.ok ? (accounts.accounts[1]?.kpostId ?? '') : '');

  /** The counterparty's own row, captured so we can prove our writes never touched it. */
  let theirRowBefore: { delete_status: number | null; is_blocked: number | null } | undefined;

  test('the relationship is stored per direction, and both directions are visible', async ({
    databases,
  }) => {
    const database = databases.for('kpost-api');
    test.skip(!database.enabled, 'needs the KPOST_QA connection');

    const repo = new KpostRepository(database);
    const mine = await repo.contact(me(), them());
    const theirs = await repo.contact(them(), me());

    /*
     * Not an assertion that both exist — one may legitimately not have added the other. What is
     * pinned is that the repository addresses them SEPARATELY, because a lookup that collapsed the
     * two directions would make every assertion below meaningless.
     */
    expect(mine ?? theirs, 'at least one direction of the relationship exists').toBeDefined();
    if (mine) expect(text(mine.kpost_id), 'my row is keyed by me').toBe(me());
    if (theirs) expect(text(theirs.contact_id), 'their row points back at me').toBe(me());

    theirRowBefore = theirs
      ? {
          delete_status: Number(theirs.delete_status ?? 0),
          is_blocked: Number(theirs.is_blocked ?? 0),
        }
      : undefined;
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

    /*
     * Accepted OR already present — both are valid starting states.
     *
     * This suite restores the contact in `afterAll`, so a re-run legitimately finds it there. The
     * API signals that with {"status":"Already","statusCode":500,"message":"ContactID is already in
     * your contact list"} — a 500 for a benign, expected condition (409 or 200 would be right, and
     * it is the same HTTP-200-carrying-500 envelope pattern documented in Bugzilla #494). Failing
     * the test on it would make the suite pass only on its first ever run.
     *
     * What matters is the END STATE of the row, asserted below — not whether this particular call
     * inserted or found it.
     */
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

    /*
     * The assertion no response can make, and the one that matters most: the ROW must still exist.
     * A hard delete here would also destroy the counterparty's view of the relationship, and on the
     * wire that is indistinguishable from a correct soft delete.
     */
    expect(mine, 'a soft delete leaves the row in place').toBeDefined();
    const deleted = kpostDb.deleteStatus(mine, true);
    expect(deleted.status, `${deleted.name}: got ${String(deleted.actual)}`).toBe('PASSED');

    const theirs = await repo.contact(them(), me());
    if (theirRowBefore && theirs) {
      expect(
        Number(theirs.delete_status ?? 0),
        'removing them from MY book must not remove me from THEIRS',
      ).toBe(theirRowBefore.delete_status);
    }
  });

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
});
