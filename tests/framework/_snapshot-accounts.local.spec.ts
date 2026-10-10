import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@fixtures';

const SNAPSHOT_PATH = path.join(__dirname, '..', '..', '.kpost-accounts-snapshot.local.json');

test.describe('probe: snapshot every kpost_id before a deep write-fuzz run', () => {
  test('snapshot', async ({ databases }) => {
    const database = databases.for('kpost-api');
    test.skip(!database.enabled, 'needs the KPOST_QA connection');
    const rows = await database.findMany<{ kpost_id: string; mobile_number: string | number }>({
      table: 'TBL_KPOST_USER_MASTER',
      where: {},
    });
    fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(rows.map((r) => r.kpost_id)), 'utf8');

    console.log(`[snapshot] ${rows.length} accounts snapshotted -> ${SNAPSHOT_PATH}`);
    expect(rows.length).toBeGreaterThan(0);
  });
});
