import { sourceLimitIds, sourceLimits } from '@api/contract/source-limits';
import { isSqlClient } from '@database/database-client';
import { expect, test } from '@fixtures';
import { FILLER_TEXT } from '@validators/request/boundary-value.validator';

/**
 * Maintenance: remove what the boundary validators left in the QA DB. `request.boundary-accept`
 * sends valid edge values, so a create endpoint really stores them (an enquiry, a Kool Kall, a
 * Katchup message, a login-history row); an edit is put back by the validator itself. The text
 * filler is distinctive (`qaboundary…`), so only bench values match. Runs after the engine in
 * `product:kpost-api` (this folder sorts after engine/), on the writable KPOST_QA connection only.
 *
 * Rows the bench created are deleted (with their child rows); a filler value in any other table is
 * cleared to NULL, as was done by hand for the first boundary run (2026-11-01).
 */
const LIKE = `${FILLER_TEXT}${FILLER_TEXT.slice(0, 3)}%`;
const NAME = /^[A-Za-z0-9_]+$/;
/** A created table is read through its newest rows only (the filler is this run's). */
const RECENT_ROWS = 50_000;
/** Auto-increment keys; a text key (uuid, session id) is scanned whole. */
const NUMERIC_KEYS = new Set(['id', 'msg_id', 'kall_id']);

/** Tables whose filler rows the bench created: key column, and the child rows to delete first. */
const CREATED_ROWS: Record<string, { key: string; children: readonly string[] }> = {
  TBL_KPOST_ENQUIRY_FORM: { key: 'id', children: [] },
  TBL_KPOST_KATCHUP_MESSAGES: {
    key: 'msg_id',
    children: [
      'TBL_KPOST_KATCHUP_GROUPREADSTATUS',
      'TBL_KPOST_SHARED_DETAILS',
      'TBL_KPOST_REPORT_DETAILS',
    ],
  },
  TBL_KPOST_KATCHUP_ATTACHMENT: { key: 'uuid', children: [] },
  TBL_KPOST_KMAIL_ATTACHMENT: { key: 'uuid', children: [] },
  TBL_KPOST_KOOL_KALL_MASTER: {
    key: 'kall_id',
    children: [
      'TBL_KPOST_KOOL_KALL_DETAILS',
      'TBL_KPOST_KALL_TRACKERS',
      'TBL_KPOST_KALL_SCHEDULE_DETAILS',
    ],
  },
  // A call whose member row carries the filler is the bench's own call: the whole call goes.
  TBL_KPOST_KOOL_KALL_DETAILS: {
    key: 'kall_id',
    children: [
      'TBL_KPOST_KOOL_KALL_DETAILS',
      'TBL_KPOST_KALL_TRACKERS',
      'TBL_KPOST_KALL_SCHEDULE_DETAILS',
      'TBL_KPOST_KOOL_KALL_MASTER',
    ],
  },
  TBL_KPOST_LOGIN_HISTORY: { key: 'id', children: [] },
  // No id column: a bench session row is found by its session id.
  TBL_KPOST_LOGIN_SESSION: { key: 'session_id', children: [] },
};

const tick = (name: string) => `\`${name}\``;

test.describe(
  'maintenance · boundary filler cleanup @api @kpost-api @database',
  { tag: ['@maintenance', '@api', '@regression'] },
  () => {
    test('nothing the boundary validators stored is left in the QA DB', async ({ databases }) => {
      test.setTimeout(600_000);
      const db = databases.for('kpost-api');
      test.skip(
        !isSqlClient(db) || !db.writable,
        'needs the writable KPOST_QA connection to remove the filler',
      );
      if (!isSqlClient(db)) return;

      // Where filler can land: the column each limit names (the field's own column), and the
      // text columns of the tables whose rows the bench creates (copies such as login history).
      const byTable = new Map<string, Set<string>>();
      const add = (t: string, c: string) => {
        if (NAME.test(t) && NAME.test(c)) byTable.set(t, (byTable.get(t) ?? new Set()).add(c));
      };
      for (const suite of ['kpost-api', 'kmail-api'] as const)
        for (const id of sourceLimitIds(suite))
          for (const limits of Object.values(sourceLimits(suite, id) ?? {}))
            for (const limit of Object.values(limits)) {
              const column = /^db-column (\w+)\.(\w+)/.exec(limit.from);
              if (column) add(column[1]!, column[2]!);
            }
      const textColumns = await db.query<{ t: string; c: string }>(
        `SELECT table_name AS t, column_name AS c FROM information_schema.columns
          WHERE table_schema = DATABASE() AND table_name IN (?)
            AND data_type IN ('varchar', 'char', 'text', 'tinytext', 'mediumtext')
            AND (character_maximum_length IS NULL OR character_maximum_length >= 13)`,
        [Object.keys(CREATED_ROWS)],
      );
      for (const { t, c } of textColumns) add(t, c);

      /** The newest rows of a created table (big tables would outlast the statement timeout). */
      const recent = async (table: string): Promise<{ clause: string; params: unknown[] }> => {
        const key = CREATED_ROWS[table]?.key;
        if (!key || !NUMERIC_KEYS.has(key)) return { clause: '', params: [] };
        const top = await db.query<{ m: number | null }>(
          `SELECT MAX(${tick(key)}) AS m FROM ${tick(table)}`,
        );
        return { clause: ` AND ${tick(key)} > ?`, params: [Number(top[0]?.m ?? 0) - RECENT_ROWS] };
      };
      const matching = (cols: readonly string[]) => ({
        where: `(${cols.map((c) => `${tick(c)} LIKE ?`).join(' OR ')})`,
        params: cols.map(() => LIKE),
      });

      const removed: string[] = [];
      for (const [table, colSet] of byTable) {
        const cols = [...colSet];
        const created = CREATED_ROWS[table];
        if (created) {
          const window = await recent(table);
          const { where, params } = matching(cols);
          const keys = (
            await db.query<{ k: unknown }>(
              `SELECT DISTINCT ${tick(created.key)} AS k FROM ${tick(table)} WHERE ${where}${window.clause}`,
              [...params, ...window.params],
            )
          ).map((r) => r.k);
          if (!keys.length) continue;
          // Every child table is keyed by the same column (msg_id / kall_id).
          for (const child of created.children)
            await db.query(`DELETE FROM ${tick(child)} WHERE ${tick(created.key)} IN (?)`, [
              keys as never,
            ]);
          await db.query(`DELETE FROM ${tick(table)} WHERE ${tick(created.key)} IN (?)`, [
            keys as never,
          ]);
          removed.push(`${table}: ${keys.length} row(s) deleted`);
          continue;
        }
        for (const col of cols) {
          const counted = await db.query<{ n: number }>(
            `SELECT COUNT(*) AS n FROM ${tick(table)} WHERE ${tick(col)} LIKE ?`,
            [LIKE],
          );
          const n = Number(counted[0]?.n ?? 0);
          if (!n) continue;
          // NULL where the column allows it, else an empty string (a NOT NULL column).
          await db
            .query(`UPDATE ${tick(table)} SET ${tick(col)} = NULL WHERE ${tick(col)} LIKE ?`, [
              LIKE,
            ])
            .catch(() =>
              db.query(`UPDATE ${tick(table)} SET ${tick(col)} = '' WHERE ${tick(col)} LIKE ?`, [
                LIKE,
              ]),
            );
          removed.push(`${table}.${col}: ${n} value(s) cleared`);
        }
      }
      test.info().annotations.push({
        type: 'cleanup',
        description: removed.length ? removed.join('; ') : 'nothing to remove',
      });

      // Proof: a second scan finds nothing.
      for (const [table, colSet] of byTable) {
        const window = await recent(table);
        const { where, params } = matching([...colSet]);
        const left = await db.query<{ n: number }>(
          `SELECT COUNT(*) AS n FROM ${tick(table)} WHERE ${where}${window.clause}`,
          [...params, ...window.params],
        );
        expect.soft(Number(left[0]?.n ?? 0), `${table}: boundary filler left`).toBe(0);
      }
    });
  },
);
