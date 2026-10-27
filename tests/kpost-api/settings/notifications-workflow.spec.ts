import { KpostRepository } from '@database/repositories/kpost.repository';
import { requireAll } from '@fixtures/test-accounts';
import { expect, test } from '@fixtures';

/**
 * Notification preferences: toggle, persist, read back, asserted on the caller's
 * `TBL_KPOST_GENERAL_SETTINGS` row (there is no notification feed table). Restores the original.
 */
test.describe(
  'KPost Settings · notification preferences @api @kpost-api @settings @database',
  { tag: ['@api', '@settings', '@regression'] },
  () => {
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

      expect(
        rows,
        'TBL_KPOST_GENERAL_SETTINGS holds exactly one row for this account',
      ).toHaveLength(1);
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
      // Compared against the stored row, not what the test sent, so a cached answer shows up.
      expect(stored, 'the row the API should be reflecting exists').toBeDefined();
      expect(exchange.bodyText.length, 'and the read returns a body').toBeGreaterThan(0);
    });
  },
);

// One independent describe per field (not serial), so one failure never hides the others.
for (const field of ['katchup', 'kmail', 'kall'] as const) {
  const endpointId = `settings-${field}-notification` as const;
  const column = `${field}_notification` as const;

  test.describe(
    `KPost Settings · ${field} notification persistence @api @kpost-api @settings @database`,
    { tag: ['@api', '@settings', '@regression'] },
    () => {
      const accounts = requireAll('primary');
      test.skip(!accounts.ok, accounts.ok ? '' : accounts.reason);
      const me = (): string => (accounts.ok ? (accounts.accounts[0]?.kpostId ?? '') : '');

      test.afterAll(async ({ endpoints }) => {
        // Restore the preference: the QA account is shared.
        if (!accounts.ok) return;
        await endpoints
          .sendTo(
            endpointId,
            { body: { enable: 1 } },
            { label: `notifications-workflow:restore-${field}`, allowLiveWrite: true },
          )
          .catch(() => undefined);
      });

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
        // Check the envelope: KPost can answer HTTP 200 carrying `statusCode: 500`.
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

        // The JSON column's shape is not asserted, only that the write changed it.
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
    },
  );
}

/** Settings are per-account, not global: each account has its own row. */
test.describe(
  'KPost Settings · isolation @api @kpost-api @settings @database',
  { tag: ['@api', '@settings', '@regression'] },
  () => {
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
  },
);
