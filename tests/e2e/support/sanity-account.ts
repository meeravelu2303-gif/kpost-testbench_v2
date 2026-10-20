import type { SqlDatabaseClient } from '@database/database-client';

/**
 * The ONE throwaway account a sanity run signs up, and its removal afterwards (owner, 2026-10-20:
 * "only one account per sanity run, then delete it from the DB; name it sanitykpost1, sanitykpost2…;
 * mock OTP").
 *
 * Why a direct DB delete and not the app's own "Delete account": that flow (Settings › Delete
 * Account → sendAccountDeactivationOtp → deactivateAccount) always sends a REAL SMS — it ignores the
 * OTP bypass — and only DEACTIVATES: the row stays, `findById` still sees the KPOST ID, so the name
 * could never be used again (SignUpLoginServiceImpl.isKpostIdExists). Deleting the rows the signup
 * created frees both the id and the mobile, so the next run starts again from sanitykpost1.
 *
 * Only rows that name THIS account are touched: every statement binds the exact KPOST ID or the
 * exact mobile number, both owned by the bench (`sanitykpost<N>@…`, `90000008NN`).
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
 * Every table a fresh Personal signup + first login writes for the new account, and the column that
 * names it. Found live on 2026-10-20 by signing up sanitykpost1 and searching KPOST_QA: the 9 foreign
 * keys into the user table, plus 132 id-like text columns (`information_schema`). Two welcome
 * messages from info@kpostindia.com arrive as Katchup rows addressed to the account; nothing hangs
 * off them (no rows in the two tables that reference a message). The audit log is left alone — it
 * is a history, not account data. Children first, the user row last (LOGIN_SESSION and USER_PROFILE
 * hold foreign keys to it).
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
  // The two welcome messages are sent a few seconds AFTER signup (seen live: 0 removed on one run, 2
  // on the next). Watch briefly for late ones so each run leaves nothing behind on its own.
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
