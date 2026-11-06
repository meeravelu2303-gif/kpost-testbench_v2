import type { DatabaseClient, DbQuery } from '@database/database-client';
import { text } from '@database/kpost-assertions';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';

/**
 * Data integrity for one write: after the flow's own call, the row it should have produced (or
 * removed) is read from the QA database and each column is compared with what was sent. The API's
 * "SUCCESS" proves nothing about what was stored; the row does.
 *
 * Read-only (a SELECT), so it is safe after any write, a shared-state one included. The test-type
 * ledger credits the endpoint id passed literally as the second argument.
 */
export interface StoredExpectation {
  table: string;
  where: DbQuery['where'];
  /**
   * Column → the value that must be stored (compared as text, BLOBs decoded), or a predicate for a
   * rule ("a timestamp after the call", "a flag set").
   */
  columns?: Record<string, unknown>;
  /** The write removed the row (a hard delete): no row may match `where`. */
  absent?: boolean;
  /** One plain sentence on what the write promises, for the failure and the finding. */
  rule: string;
}

type Predicate = (value: unknown) => boolean;
const SECRET_COLUMN = /password|access_?code|secret|token|otp/i;
const isPredicate = (v: unknown): v is Predicate => typeof v === 'function';

/** Same value as text, so 1 / '1' / true-as-1 and a BLOB / its string compare equal. */
function same(actual: unknown, expected: unknown): boolean {
  if (expected === null || expected === undefined) return actual === null || actual === undefined;
  if (typeof expected === 'boolean')
    return text(actual) === (expected ? '1' : '0') || text(actual) === String(expected);
  return text(actual) === text(expected);
}

/**
 * Checks the stored row, softly, so the flow carries on. A mismatch is recorded as a finding when
 * `findings` is given (the flow's executor). Without a database the check says so and passes no
 * judgement.
 */
export async function expectStored(
  db: DatabaseClient,
  endpointId: string,
  expected: StoredExpectation,
  findings?: EndpointExecutor,
): Promise<void> {
  const info = test.info();
  if (!db.enabled) {
    info.annotations.push({
      type: 'db-not-checked',
      description: `${endpointId}: no QA database connection, so what it stored was not read`,
    });
    return;
  }
  const query = { table: expected.table, where: expected.where };
  const row = await db.findOne<Record<string, unknown>>(query);
  const problems: string[] = [];
  if (expected.absent) {
    if (row) problems.push(`a row still matches ${JSON.stringify(expected.where)}`);
  } else if (!row) {
    problems.push(`no row matches ${JSON.stringify(expected.where)}`);
  } else {
    for (const [column, want] of Object.entries(expected.columns ?? {})) {
      const got = row[column];
      const ok = isPredicate(want) ? want(got) : same(got, want);
      // A secret's value (a password hash, an access code, a token) never reaches a report.
      if (!ok && SECRET_COLUMN.test(column))
        problems.push(`${column} does not hold what the write promised (value hidden)`);
      else if (!ok)
        problems.push(
          `${column} is ${JSON.stringify(text(got) ?? null)}${isPredicate(want) ? '' : `, expected ${JSON.stringify(text(want) ?? null)}`}`,
        );
    }
  }
  info.annotations.push({
    type: 'db-checked',
    description: `${endpointId}: ${expected.table} ${JSON.stringify(expected.where)} — ${problems.length ? problems.join('; ') : 'as sent'}`,
  });
  if (problems.length && findings)
    findings.recordBusinessRuleViolation({
      endpointId,
      ruleId: `DATA-${endpointId}-${expected.table}`,
      rule: expected.rule,
      expected: expected.absent
        ? `no row in ${expected.table} for ${JSON.stringify(expected.where)}`
        : `${expected.table} holds ${JSON.stringify(Object.keys(expected.columns ?? {}))} as sent`,
      actual: `${expected.table}: ${problems.join('; ')}`,
    });
  expect.soft(problems, `${endpointId}: ${expected.rule}`).toEqual([]);
}

/**
 * A timestamp column set at or after `since` (epoch ms), allowing a little clock skew. Measured
 * 2026-11-05: the QA DB and this PC run IST, but the backend (JVM in UTC) writes some timestamps in
 * UTC (login_time read 5½ h behind), and the driver reads every DATETIME as local time. So a value is
 * accepted when it is at/after `since` read either way: local, or UTC shifted to local.
 */
export const atOrAfter =
  (since: number, skewMs = 120_000): Predicate =>
  (value) => {
    const t = value instanceof Date ? value.getTime() : Date.parse(String(value));
    if (!Number.isFinite(t)) return false;
    const utcShiftMs = -new Date(t).getTimezoneOffset() * 60_000;
    return t >= since - skewMs || t + utcShiftMs >= since - skewMs;
  };

/** Any value at all (the column is filled). */
export const filled: Predicate = (value) =>
  value !== null && value !== undefined && text(value) !== '';
