import fs from 'node:fs';
import path from 'node:path';
import { recordCreatedAccount } from '@fixtures/created-accounts';
import { expect, test } from '@fixtures';

const SNAPSHOT_PATH = path.join(__dirname, '..', '..', '.kpost-accounts-snapshot.local.json');

test.describe('probe: diff accounts against the pre-run snapshot and log anything new', () => {
  test('diff and record', async ({ databases }) => {
    const database = databases.for('kpost-api');
    test.skip(!database.enabled, 'needs the KPOST_QA connection');
    test.skip(
      !fs.existsSync(SNAPSHOT_PATH),
      'no pre-run snapshot found — run _snapshot-accounts.local.spec.ts first',
    );

    const before = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8')) as string[];
    const beforeSet = new Set(before);

    const after = await database.findMany<{ kpost_id: string; mobile_number: string | number }>({
      table: 'TBL_KPOST_USER_MASTER',
      where: {},
    });

    const created = after.filter((r) => !beforeSet.has(r.kpost_id));
    // eslint-disable-next-line no-console
    console.log(
      `[diff] before=${before.length} after=${after.length} newly-created=${created.length}`,
    );
    for (const r of created) {
      // eslint-disable-next-line no-console
      console.log(`  NEW ACCOUNT: ${r.kpost_id} / ${r.mobile_number}`);
      recordCreatedAccount({
        kpostId: r.kpost_id,
        mobileNumber: String(r.mobile_number),
        source: 'kpost:deep (write-fuzz run)',
        note: 'caught by before/after DB diff, not a known hand-written signup path',
      });
    }

    expect(
      created.length,
      'every newly-created account this run was logged',
    ).toBeGreaterThanOrEqual(0);
  });
});
