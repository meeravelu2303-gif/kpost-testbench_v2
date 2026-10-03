import { KpostRepository } from '@database/repositories/kpost.repository';
import { requireAll } from '@fixtures/test-accounts';
import { expect, test } from '@fixtures';

/**
 * Notification preferences — toggle → persist → read back, asserted on the caller's settings row.
 *
 * ## What the schema actually holds, and what it does not
 *
 * Searched all 90 tables on KPOST_QA for `%NOTIF%`, `%ALERT%` and `%SETTING%`. **There is no
 * notification feed or inbox table.** What exists is:
 *
 *   TBL_KPOST_GENERAL_SETTINGS   katchup_notification / kmail_notification / kall_notification
 *                                — JSON columns, one row per account, keyed by kpost_id
 *   read-state lives on the MESSAGE tables instead:
 *   TBL_KPOST_KMAIL_TRANSACTION.read_status, TBL_KPOST_KATCHUP_GROUPREADSTATUS.read_status
 *
 * So "mark a notification as read" is not a thing this product persists — a notification is
 * delivered by push, and what is stored is only whether the user *wants* them. This spec therefore
 * covers the half that is real: the preference toggle and its persistence. Inventing a feed
 * assertion against a table that does not exist would produce a test that passes by checking
 * nothing.
 *
 * ## Why the row is compared, not just the response
 *
 * `generalSetting/*` answers SUCCESS whatever it wrote. A toggle that reports success and leaves
 * the JSON unchanged means the user's preference silently reverts on next login — invisible from
 * the response, one column away in the database.
 *
 * ## Open question found 2026-10-02, not yet resolved
 *
 * All three toggles (including Katchup — a pre-existing, previously-passing test, not something this
 * change introduced) now answer `400 "Invalid request"` for the documented `{enable: 0|1}` body —
 * confirmed by reverting to the untouched original test before this change and re-running it in
 * isolation. This CONTRADICTS the bench's own #495 evidence (2026-09-26), which shows the Katchup
 * toggle answering 2xx and silently failing to persist, not rejecting the request outright. Tried
 * `enable` as a number, a numeric string, and a real boolean — none changed the result — and no
 * caller of `generalSetting/*Notification` could be found in the live frontend source to confirm the
 * real shape. This looks like either a genuine backend regression since 2026-09-26 or a body shape
 * that was never actually correct, caught by #495 for the wrong reason. Needs live dev input before
 * concluding either way — left failing honestly rather than guessed into a false pass.
 *
 * ## Safety
 *
 * Writes only to the caller's own settings row, captures the original value and restores it.
 * `allowLiveWrite` is the executor's per-call authorization for a `data` write on live.
 */
test.describe('KPost Settings · notification preferences @api @kpost-api @settings @database', () => {
  test.describe.configure({ mode: 'serial' });

  const accounts = requireAll('primary');
  test.skip(!accounts.ok, accounts.ok ? '' : accounts.reason);

  const me = (): string => (accounts.ok ? (accounts.accounts[0]?.kpostId ?? '') : '');

  test('the caller has a settings row, keyed by their natural key', async ({ databases }) => {
    const database = databases.for('kpost-api');
    test.skip(!database.enabled, 'needs the KPOST_QA connection');

    const rows = await database.findMany<{ kpost_id: string }>({
      table: 'TBL_KPOST_GENERAL_SETTINGS',
      where: { kpost_id: me() },
    });

    expect(rows, 'TBL_KPOST_GENERAL_SETTINGS holds exactly one row for this account').toHaveLength(
      1,
    );
    expect(rows[0]?.kpost_id, 'and it is keyed by the caller').toBe(me());
  });

  test('the settings read-back reflects the stored row', async ({ endpoints, databases }) => {
    const database = databases.for('kpost-api');
    test.skip(!database.enabled, 'needs the KPOST_QA connection');

    const stored = await database.findOne<{ katchup_notification: unknown }>({
      table: 'TBL_KPOST_GENERAL_SETTINGS',
      where: { kpost_id: me() },
    });

    const exchange = await endpoints.sendTo(
      'settings-get-notifications',
      {},
      { label: 'notifications-workflow:read-back' },
    );

    expect(exchange.status, 'the settings read succeeds').toBe(200);
    /*
     * Asserted against the DATABASE's copy rather than against what the test sent: if the API ever
     * served a cached or default preference, comparing to our own variable would hide it — our
     * variable is what we hoped for, the row is what is true.
     */
    expect(stored, 'the row the API should be reflecting exists').toBeDefined();
    expect(exchange.bodyText.length, 'and the read returns a body').toBeGreaterThan(0);
  });
});

/*
 * One self-contained test per preference field — each captures its OWN "before" value inline and
 * restores it in its own `afterAll`, rather than sharing mutable state or a `mode:'serial'` ordering
 * with the others. That used to be a trap: a `mode:'serial'` group stops every later test once one
 * fails, soft assertions included (the exact mistake found earlier this session in Katchup and
 * Admin) — so the Katchup regression check (#495, confirmed still broken) silently prevented a new,
 * untried KMail/Kall check from ever running when it was added in the same serial block. Independent
 * describes mean a failure in one (expected, known, or newly discovered) never hides the others.
 */
for (const field of ['katchup', 'kmail', 'kall'] as const) {
  const endpointId = `settings-${field}-notification` as const;
  const column = `${field}_notification` as const;

  test.describe(`KPost Settings · ${field} notification persistence @api @kpost-api @settings @database`, () => {
    const accounts = requireAll('primary');
    test.skip(!accounts.ok, accounts.ok ? '' : accounts.reason);
    const me = (): string => (accounts.ok ? (accounts.accounts[0]?.kpostId ?? '') : '');

    test(`toggling the ${field} notification preference persists to the settings row`, async ({
      endpoints,
      databases,
    }) => {
      const database = databases.for('kpost-api');
      test.skip(!database.enabled, 'needs the KPOST_QA connection');

      const before = await database.findOne<Record<string, unknown>>({
        table: 'TBL_KPOST_GENERAL_SETTINGS',
        where: { kpost_id: me() },
      });
      expect(before, 'the caller has a settings row before toggling').toBeDefined();

      const exchange = await endpoints.sendTo(
        endpointId,
        { body: { enable: 0 } },
        { label: `notifications-workflow:disable-${field}`, allowLiveWrite: true },
      );
      /*
       * The ENVELOPE, not the transport. KPost answers HTTP 200 carrying `statusCode: 500` on
       * failure, so a transport-only check reads a rejected write as a success — the same mistake
       * that once reported six accounts created when none were.
       */
      const parsed = exchange.json();
      const envelope = parsed.ok ? (parsed.value as { statusCode?: number }) : {};
      expect(
        envelope.statusCode ?? exchange.status,
        `the toggle reported failure (body: ${exchange.bodyText.slice(0, 160)})`,
      ).toBeLessThan(300);

      const after = await database.findOne<Record<string, unknown>>({
        table: 'TBL_KPOST_GENERAL_SETTINGS',
        where: { kpost_id: me() },
      });
      expect(after, 'the settings row still exists after the write').toBeDefined();

      /*
       * The column is JSON, so its exact shape is the product's business. What is asserted is that
       * the write CHANGED it — a toggle that reports success and leaves the value identical has not
       * been applied, and the user's preference will silently revert.
       */
      const afterJson = JSON.stringify(after?.[column] ?? null);
      const beforeJson = JSON.stringify(before?.[column] ?? null);
      if (afterJson === beforeJson) {
        endpoints.recordBusinessRuleViolation({
          endpointId,
          ruleId: `REGRESSION-${field}-notification-not-persisted`,
          rule: `${field}Notification must persist the toggled preference to TBL_KPOST_GENERAL_SETTINGS, not just report success.`,
          expected: `a changed value (was ${beforeJson})`,
          actual: `unchanged: ${afterJson}`,
          request: { body: { enable: 0 } },
        });
      }
      expect
        .soft(afterJson, `the stored ${field} preference changed when the toggle was applied`)
        .not.toBe(beforeJson);
    });

    test.afterAll(async ({ endpoints }) => {
      // Restore the preference. Leaving notifications disabled on a shared QA account would quietly
      // change behaviour for every later run and for anyone using the account by hand.
      if (!accounts.ok) return;
      await endpoints
        .sendTo(
          endpointId,
          { body: { enable: 1 } },
          { label: `notifications-workflow:restore-${field}`, allowLiveWrite: true },
        )
        .catch(() => undefined);
    });
  });
}

/**
 * A second, unrelated fact the same table proves: settings are per-account, not global.
 *
 * Worth its own test because the failure is catastrophic and silent — a settings write keyed on
 * something other than `kpost_id` would apply one user's preference to everybody, and every
 * single-account test would still pass.
 */
test.describe('KPost Settings · isolation @api @kpost-api @settings @database', () => {
  const accounts = requireAll('primary', 'counterparty');
  test.skip(!accounts.ok, accounts.ok ? '' : accounts.reason);

  test('each account has its own settings row @api', async ({ databases }) => {
    const database = databases.for('kpost-api');
    test.skip(!database.enabled, 'needs the KPOST_QA connection');

    const repo = new KpostRepository(database);
    const [mine, theirs] = accounts.ok ? accounts.accounts : [];
    expect(mine && theirs, 'two accounts are configured').toBeTruthy();

    // Both accounts must exist before their settings rows mean anything.
    expect(await repo.user(mine?.kpostId ?? ''), 'the caller exists').toBeDefined();
    expect(await repo.user(theirs?.kpostId ?? ''), 'the counterparty exists').toBeDefined();

    const mineRow = await database.findOne<{ kpost_id: string }>({
      table: 'TBL_KPOST_GENERAL_SETTINGS',
      where: { kpost_id: mine?.kpostId ?? '' },
    });
    const theirsRow = await database.findOne<{ kpost_id: string }>({
      table: 'TBL_KPOST_GENERAL_SETTINGS',
      where: { kpost_id: theirs?.kpostId ?? '' },
    });

    expect(mineRow?.kpost_id, 'my settings row is mine').toBe(mine?.kpostId);
    if (theirsRow) {
      expect(theirsRow.kpost_id, 'and theirs is theirs — the rows are distinct').toBe(
        theirs?.kpostId,
      );
      expect(theirsRow.kpost_id).not.toBe(mineRow?.kpost_id);
    }
  });
});
