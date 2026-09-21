import type { CheckDetail } from '@engine/validation-result';
import { runSimultaneously } from '@utils/concurrency';
import type { JsonObject } from '@utils/json';
import {
  buildWhere,
  isSqlClient,
  qualify,
  type DatabaseClient,
  type DbQuery,
  type IsolationLevel,
} from './database-client';

/**
 * Persistence checks that only a real database can answer, and only under concurrency.
 *
 * ## Why these are separate from `db-assertions.ts`
 *
 * Those assertions ask "is this record what the request said it would be?" — one row, one moment,
 * answerable through any adapter including the mock's in-memory store. The ones here ask what the
 * database did when two things happened at once, which needs real transactions on real
 * connections. Mixing them would mean every mock-backed run appearing to exercise transaction
 * isolation while checking nothing of the kind.
 *
 * Every check below is **read-only**, so none of them needs `DB_ALLOW_WRITES`. That is a deliberate
 * limit rather than an oversight: staging a dirty-read experiment means writing uncommitted rows
 * into a shared schema, and the value of that finding does not justify a bench that can corrupt the
 * data other suites assert against.
 */

const unavailable = (name: string, db: DatabaseClient): CheckDetail => ({
  name,
  status: 'SKIPPED',
  message: db.enabled
    ? 'the configured database adapter has no transaction support (mock store) — set DB_HOST/DB_NAME to run this against MySQL'
    : 'no database is configured for this suite, so persistence was NOT verified',
});

/**
 * Exactly `expected` rows match `where`.
 *
 * This is what closes the loop on the duplicate-write race: the API can answer "201 Created" twice
 * and still have written one row, or answer "409 Conflict" and have written two. Only the row count
 * settles it, and only the database knows it.
 */
export async function assertRowCount(
  db: DatabaseClient,
  query: DbQuery,
  expected: number,
  correlationId?: string,
): Promise<CheckDetail> {
  const name = `${query.table} holds exactly ${expected} matching row(s)`;
  if (!db.enabled) return unavailable(name, db);
  try {
    const actual = await db.count(query, correlationId);
    return {
      name,
      status: actual === expected ? 'PASSED' : 'FAILED',
      expected,
      actual,
      message:
        actual === expected
          ? undefined
          : actual > expected
            ? `${actual} rows exist where ${expected} should — the uniqueness rule is not enforced by the database`
            : `${actual} rows exist where ${expected} should — the write did not persist`,
      correlationId,
    };
  } catch (error) {
    return {
      name,
      status: 'FAILED',
      expected,
      actual: 'query failed',
      message: `the row count could not be read: ${(error as Error).message}`,
      correlationId,
    };
  }
}

/**
 * Inside one `REPEATABLE READ` transaction, the same query twice returns the same rows — even
 * though other traffic committed in between.
 *
 * ## What a failure means
 *
 * InnoDB's REPEATABLE READ — MySQL's own default — establishes a consistent-read snapshot at the
 * transaction's first read and serves every later plain SELECT from it, so the second read is
 * guaranteed identical. If it is not, the two statements did not share a transaction: almost always
 * an application-level pool handing each query a different connection, which silently downgrades
 * every "transaction" in the codebase to a sequence of autocommits. That is the defect this looks
 * for, and it is invisible until two reads straddle someone else's commit.
 *
 * The probe writes nothing. It relies on whatever concurrent traffic the environment already has;
 * on a completely idle database it passes trivially, which is reported honestly rather than dressed
 * up as proof.
 */
export async function assertRepeatableRead(
  db: DatabaseClient,
  query: DbQuery,
  correlationId?: string,
): Promise<CheckDetail> {
  const name = `${query.table} reads are repeatable inside one transaction`;
  if (!isSqlClient(db)) return unavailable(name, db);

  /*
   * Built by the client's own quoting, not by a second copy of the rules here: one validated
   * identifier path means a fix to it protects every caller, and there is no chance of the two
   * drifting until only one of them rejects a hostile name.
   */
  let text: string;
  let values: unknown[];
  try {
    const where = buildWhere(query.where);
    text = `SELECT COUNT(*)::text AS count FROM ${qualify(query.table)} ${where.clause}`;
    values = where.values;
  } catch (error) {
    return { name, status: 'FAILED', message: (error as Error).message };
  }

  try {
    const { first, second } = await db.transaction(
      async (tx) => {
        const a = await tx.query<{ count: string }>(text, values);
        /*
         * A short gap so another session has the chance to commit between the two reads. Without
         * it both statements execute in the same millisecond and the check passes for the wrong
         * reason — not because the snapshot held, but because nothing could have changed.
         */
        await new Promise((resolve) => setTimeout(resolve, 250));
        const b = await tx.query<{ count: string }>(text, values);
        return { first: Number(a[0]?.count ?? 0), second: Number(b[0]?.count ?? 0) };
      },
      { isolation: 'REPEATABLE READ', readOnly: true },
    );

    return {
      name,
      status: first === second ? 'PASSED' : 'FAILED',
      expected: `both reads see ${first} row(s)`,
      actual: { first, second },
      message:
        first === second
          ? undefined
          : `the snapshot did not hold (${first} then ${second}) — the two statements ran on different connections, so the transaction was not a transaction`,
      correlationId,
    };
  } catch (error) {
    return {
      name,
      status: 'FAILED',
      expected: 'a repeatable-read transaction',
      actual: 'transaction failed',
      message: `the isolation probe could not run: ${(error as Error).message}`,
      correlationId,
    };
  }
}

/**
 * Two transactions at the given isolation level read the same rows simultaneously and agree.
 *
 * Read-only by construction, so the only way it can fail is a genuine fault: a connection returning
 * another session's result set, or one of the two transactions erroring under contention. It is the
 * database-layer counterpart to `concurrency.read-consistency` at the API layer — and running both
 * is what distinguishes "the API mixed up two callers" from "the database did".
 */
export async function assertConcurrentReadAgreement(
  db: DatabaseClient,
  query: DbQuery,
  options: { isolation?: IsolationLevel; readers?: number } = {},
  correlationId?: string,
): Promise<CheckDetail> {
  const name = `${query.table} agrees across ${options.readers ?? 2} simultaneous transactions`;
  if (!isSqlClient(db)) return unavailable(name, db);

  const readers = Math.max(2, Math.min(options.readers ?? 2, 8));
  let text: string;
  let values: unknown[];
  try {
    const where = buildWhere(query.where);
    text = `SELECT COUNT(*)::text AS count FROM ${qualify(query.table)} ${where.clause}`;
    values = where.values;
  } catch (error) {
    return { name, status: 'FAILED', message: (error as Error).message };
  }

  try {
    const burst = await runSimultaneously(readers, () =>
      db.transaction(
        async (tx) => {
          const rows = await tx.query<JsonObject>(text, values);
          return Number((rows[0]?.count as string | undefined) ?? 0);
        },
        { isolation: options.isolation ?? 'READ COMMITTED', readOnly: true },
      ),
    );

    const failures = burst.outcomes.filter((o) => o.error);
    const counts = burst.outcomes.flatMap((o) => (o.value === undefined ? [] : [o.value]));
    const distinct = new Set(counts);

    if (failures.length > 0) {
      return {
        name,
        status: 'FAILED',
        expected: `${readers} transactions complete`,
        actual: `${failures.length} failed`,
        message: `concurrent transactions errored: ${failures[0]?.error?.message ?? 'unknown'}`,
        correlationId,
      };
    }
    return {
      name,
      status: distinct.size <= 1 ? 'PASSED' : 'FAILED',
      expected: 'one agreed row count',
      actual: { counts, dispatchSkewMs: burst.dispatchSkewMs },
      message:
        distinct.size <= 1
          ? undefined
          : `simultaneous readers disagreed (${[...distinct].join(', ')}) on a read-only query — either a write committed mid-burst or a connection returned another session's result`,
      correlationId,
    };
  } catch (error) {
    return {
      name,
      status: 'FAILED',
      expected: 'concurrent read agreement',
      actual: 'probe failed',
      message: `the concurrent-read probe could not run: ${(error as Error).message}`,
      correlationId,
    };
  }
}
