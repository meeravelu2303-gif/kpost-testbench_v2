import type { SqlDatabaseClient } from '@database/database-client';

/**
 * The one throwaway `sanitykpost<N>` account a sanity run signs up, and its DB removal afterwards.
 * The app's own "Delete account" sends a real SMS and only deactivates, so the rows are deleted
 * directly; every statement binds this account's exact KPOST ID or mobile.
 */

/** The pieces of one sanity identity. */
export interface SanityIdentity {
  n: number;
  local: string;
  kpostId: string;
  mobile: string;
}

const USER_TABLE = 'TBL_KPOST_USER_MASTER';

/**
 * Every table a Personal signup + first login writes for the account, and the column naming it.
 * Children first, the user row last (foreign keys); the audit log is left alone.
 */
export const SIGNUP_FOOTPRINT: ReadonlyArray<{
  table: string;
  column: string;
  by: 'id' | 'mobile';
}> = [
  { table: 'TBL_KPOST_LOGIN_SESSION', column: 'kpost_id', by: 'id' },
  // Written by a LOGOUT (journey 1a signs out); FK to the user row, so it goes first.
  { table: 'TBL_KPOST_LOGIN_HISTORY', column: 'kpost_id', by: 'id' },
  { table: 'TBL_KPOST_USER_PROFILE', column: 'kpost_id', by: 'id' },
  { table: 'TBL_KPOST_USERS_KMAIL_SETTINGS', column: 'kpost_id', by: 'id' },
  { table: 'TBL_KPOST_USER_PHONECONTACT_DETAILS', column: 'kpost_id', by: 'id' },
  { table: 'TBL_KPOST_KATCHUP_MESSAGES', column: 'receiver', by: 'id' },
  { table: 'TBL_KPOST_OTP_VALIDATION', column: 'mobile_number', by: 'mobile' },
  { table: USER_TABLE, column: 'kpost_id', by: 'id' },
];

/** The lowest N whose `sanitykpost<N>` id and `90000008NN` mobile are both free. */
export async function nextSanityIdentity(
  db: SqlDatabaseClient,
  domain: string,
): Promise<SanityIdentity> {
  const taken = await db.query<{ kpost_id: string; mobile_number: string }>(
    `SELECT kpost_id, mobile_number FROM ${USER_TABLE} WHERE kpost_id LIKE ? OR mobile_number LIKE ?`,
    [`sanitykpost%@${domain}`, '90000008%'],
  );
  const ids = new Set(taken.map((r) => String(r.kpost_id).toLowerCase()));
  const mobiles = new Set(taken.map((r) => String(r.mobile_number)));
  for (let n = 1; n <= 99; n++) {
    const local = `sanitykpost${n}`;
    const kpostId = `${local}@${domain}`;
    const mobile = `90000008${String(n).padStart(2, '0')}`;
    if (!ids.has(kpostId) && !mobiles.has(mobile)) return { n, local, kpostId, mobile };
  }
  throw new Error('sanitykpost1..99 are all taken — earlier clean-ups failed; clear them first');
}

/**
 * Delete the account's rows, children first. Returns rows removed per table, and throws if the user
 * row is still there afterwards — a sanity run must never leave its account behind silently.
 */
export async function deleteSanityAccount(
  db: SqlDatabaseClient,
  who: Pick<SanityIdentity, 'kpostId' | 'mobile'>,
): Promise<Record<string, number>> {
  const removed: Record<string, number> = {};
  for (const { table, column, by } of SIGNUP_FOOTPRINT) {
    if (!/^[A-Z0-9_]+$/i.test(table) || !/^[a-z0-9_]+$/i.test(column))
      throw new Error(`unsafe identifier ${table}.${column}`);
    const value = by === 'id' ? who.kpostId : who.mobile;
    // `query` returns rows only (a DELETE's affectedRows is not surfaced), so count first.
    const [before] = await db.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`,
      [value],
    );
    await db.query(`DELETE FROM ${table} WHERE ${column} = ?`, [value]);
    removed[table] = (removed[table] ?? 0) + Number(before?.n ?? 0);
  }
  // The welcome messages arrive a few seconds after signup, so watch briefly for late ones.
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 2_000));
    const [late] = await db.query<{ n: string }>(
      'SELECT COUNT(*) AS n FROM TBL_KPOST_KATCHUP_MESSAGES WHERE receiver = ?',
      [who.kpostId],
    );
    if (Number(late?.n ?? 0) > 0) {
      await db.query('DELETE FROM TBL_KPOST_KATCHUP_MESSAGES WHERE receiver = ?', [who.kpostId]);
      removed.TBL_KPOST_KATCHUP_MESSAGES =
        (removed.TBL_KPOST_KATCHUP_MESSAGES ?? 0) + Number(late?.n);
    }
  }
  const left = await db.query(`SELECT kpost_id FROM ${USER_TABLE} WHERE kpost_id = ?`, [
    who.kpostId,
  ]);
  if (left.length > 0)
    throw new Error(`${who.kpostId} is still in ${USER_TABLE} after the clean-up`);
  return removed;
}
