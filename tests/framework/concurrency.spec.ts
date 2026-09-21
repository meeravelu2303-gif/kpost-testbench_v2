import { env } from '@config/env';
import { thresholds } from '@config/thresholds.config';
import {
  buildWhere,
  isReadOnlyStatement,
  qualify,
  quoteIdentifier,
} from '@database/database-client';
import type { ResolvedEndpoint } from '@engine/validation-policy';
import { expect, test } from '@fixtures';
import { runSimultaneously } from '@utils/concurrency';
import {
  burstSize,
  canonicalBody,
  identityOf,
  inconclusiveIfSerialized,
} from '@validators/concurrency/support';
import { validationRegistry } from '@validators/index';

/**
 * The concurrency layer, proved without a host and without a database.
 *
 * Everything here is the part of a concurrency finding that must be right before the finding can be
 * believed: that the burst really was simultaneous, that two responses are only called different
 * when they meaningfully differ, and that a table name can never become SQL. A race probe whose
 * dispatcher quietly serializes reports PASSED on an endpoint it never tested — so the dispatcher
 * is tested here rather than trusted.
 *
 * These run with no environment, so they cannot be skipped for want of a target.
 */
test.describe('concurrency primitives @framework', () => {
  test('a burst dispatches every task from the same tick', async () => {
    const dispatchedAt: number[] = [];

    const result = await runSimultaneously(8, async (index) => {
      dispatchedAt.push(performance.now());
      await new Promise((resolve) => setTimeout(resolve, 20));
      return index;
    });

    expect(result.outcomes, 'every task produced an outcome').toHaveLength(8);
    expect(
      result.outcomes.every((o) => o.status === 'fulfilled'),
      'no task was reported as rejected',
    ).toBe(true);
    /*
     * The point of the barrier. If the tasks were started by the map itself, each 20ms sleep would
     * be serialized and the spread would be ~160ms; released together it is a couple of
     * milliseconds. This is the assertion that would catch a refactor removing the barrier.
     */
    expect(result.dispatchSkewMs, 'the tasks left together').toBeLessThanOrEqual(
      thresholds.concurrency.maxDispatchSkewMs,
    );
    expect(Math.max(...dispatchedAt) - Math.min(...dispatchedAt)).toBeLessThan(100);
  });

  test('a rejection is captured, never thrown, so one failure cannot hide the rest', async () => {
    const result = await runSimultaneously(4, (index) =>
      index === 1 ? Promise.reject(new Error('boom')) : Promise.resolve(index),
    );

    expect(result.outcomes, 'all four outcomes are reported').toHaveLength(4);
    const failures = result.outcomes.filter((o) => o.status === 'rejected');
    expect(failures, 'exactly the one rejection is captured').toHaveLength(1);
    expect(failures[0]?.error?.message).toBe('boom');
    expect(
      result.outcomes.filter((o) => o.status === 'fulfilled'),
      'the other three still reported their values',
    ).toHaveLength(3);
  });

  test('a burst that did not overlap is inconclusive, never a pass', () => {
    const serialized = {
      outcomes: [],
      dispatchSkewMs: thresholds.concurrency.maxDispatchSkewMs + 1,
      totalMs: 900,
    };

    const verdict = inconclusiveIfSerialized(serialized, 'read burst');

    expect(verdict?.status, 'a serialized burst must not report PASSED').toBe('SKIPPED');
    expect(verdict?.message).toContain('did not overlap');

    const overlapped = { outcomes: [], dispatchSkewMs: 0, totalMs: 40 };
    expect(
      inconclusiveIfSerialized(overlapped, 'read burst'),
      'a genuinely simultaneous burst is not refused',
    ).toBeUndefined();
  });
});

test.describe('response comparison @framework', () => {
  test('key order alone is never a divergence', () => {
    const a = { data: { name: 'x', id: 1 } };
    const b = { data: { id: 1, name: 'x' } };

    expect(canonicalBody(a), 'JSON key order is not significant').toBe(canonicalBody(b));
  });

  test('server-generated fields are masked, so ordinary volatility is not a race', () => {
    const first = { data: { id: 7 }, timestamp: '2026-09-21T10:00:00Z', requestId: 'a' };
    const second = { data: { id: 7 }, timestamp: '2026-09-21T10:00:01Z', requestId: 'b' };

    expect(canonicalBody(first), 'a moving clock is not a bleed').toBe(canonicalBody(second));
  });

  test('a real difference in the payload still shows', () => {
    const mine = { data: { kpostID: 'QA001' } };
    const theirs = { data: { kpostID: 'QA002' } };

    expect(canonicalBody(mine), 'a different record must not be masked away').not.toBe(
      canonicalBody(theirs),
    );
  });

  test('an endpoint can declare its own volatile path', () => {
    const a = { data: { views: 10, id: 3 } };
    const b = { data: { views: 11, id: 3 } };

    expect(canonicalBody(a), 'undeclared, a counter reads as a difference').not.toBe(
      canonicalBody(b),
    );
    expect(canonicalBody(a, ['data.views']), 'declared, it is excluded').toBe(
      canonicalBody(b, ['data.views']),
    );
  });

  test('identity comparison is skipped rather than invented when no path is declared', () => {
    const body = { data: { kpostID: 'QA001' } };

    expect(identityOf(body, undefined), 'nothing to compare').toBeUndefined();
    expect(identityOf(body, []), 'an empty list is still nothing to compare').toBeUndefined();
    expect(identityOf(body, ['data.kpostID'])).toBe(JSON.stringify(['QA001']));
    expect(
      identityOf({ data: {} }, ['data.kpostID']),
      'a missing identity is null, not an exception',
    ).toBe(JSON.stringify([null]));
  });

  /** A ResolvedEndpoint stub carrying only the field `burstSize` reads. */
  const endpoint = (concurrency: { requests?: number }): ResolvedEndpoint =>
    ({ concurrency }) as ResolvedEndpoint;

  test('the burst size is clamped to the central cap whatever an endpoint asks for', () => {
    expect(burstSize(endpoint({})), 'the default applies').toBe(
      thresholds.concurrency.defaultRequests,
    );
    expect(burstSize(endpoint({ requests: 1_000 })), 'a huge request is capped').toBe(
      thresholds.concurrency.maxRequests,
    );
    expect(
      burstSize(endpoint({ requests: 1 })),
      'a burst of one cannot race, so it is raised to two',
    ).toBe(2);
  });
});

test.describe('SQL identifier safety @framework', () => {
  /*
   * Values are bound as parameters, but table and column names cannot be — MySQL does not
   * parameterize identifiers — so they are the one part of a statement built by concatenation, and
   * therefore the one place an injection could enter. These pin the rule that makes it safe: the
   * pattern must reject a backtick, which is what MySQL's own identifier quoting uses.
   */
  const HOSTILE = [
    'users; DROP TABLE users',
    'users"',
    // The one that matters most on MySQL: a backtick would close the identifier quoting itself.
    'users`',
    'users`; DROP TABLE users; -- ',
    "users' OR '1'='1",
    'users--',
    'users users',
    '',
    '1users',
    'users/*',
    'users#',
  ];

  test('a hostile table name is refused, never interpolated', () => {
    for (const name of HOSTILE) {
      expect(() => qualify(name), `"${name}" must be refused`).toThrow(/Unsafe SQL/);
    }
  });

  test('a hostile column name is refused', () => {
    for (const name of HOSTILE) {
      expect(() => quoteIdentifier(name, 'column'), `"${name}" must be refused`).toThrow(
        /Unsafe SQL/,
      );
    }
  });

  test('an over-qualified name is refused rather than half-parsed', () => {
    expect(() => qualify('KPOST_QA.public.users')).toThrow(/too many qualifiers/);
  });

  test('a legitimate name is backtick-quoted, and left unqualified by default', () => {
    /*
     * Unqualified, deliberately: in MySQL the database IS the schema and the connection already
     * selected it, so prefixing a configured schema would name the wrong thing.
     */
    expect(qualify('users')).toBe('`users`');
    expect(qualify('KPOST_QA.users'), 'an explicit database is honoured').toBe(
      '`KPOST_QA`.`users`',
    );
  });

  test('values become ? placeholders, and null becomes IS NULL', () => {
    /*
     * `column = NULL` is never true in SQL, so building it would turn "this field was cleared, as
     * expected" into "the record does not exist" — a passing assertion that reports the wrong fact.
     */
    const { clause, values } = buildWhere({ id: 7, deletedAt: null, name: 'qa' });

    expect(clause).toBe('WHERE `id` = ? AND `deletedAt` IS NULL AND `name` = ?');
    expect(values, 'only the non-null values are bound').toEqual([7, 'qa']);
  });

  test('the ? placeholders stay aligned with the values when a null sits between them', () => {
    /*
     * MySQL binds positionally, so an `IS NULL` term that wrongly consumed a placeholder would
     * shift every later value by one — silently querying the right columns with the wrong data.
     */
    const { clause, values } = buildWhere({ a: 1, b: null, c: 2, d: null, e: 3 });

    expect(clause).toBe('WHERE `a` = ? AND `b` IS NULL AND `c` = ? AND `d` IS NULL AND `e` = ?');
    expect((clause.match(/\?/g) ?? []).length, 'one placeholder per bound value').toBe(
      values.length,
    );
    expect(values).toEqual([1, 2, 3]);
  });

  test('a read-only statement is recognised, and a write is not', () => {
    for (const sql of ['SELECT 1', '  select * from users', 'SHOW TABLES', 'DESCRIBE users']) {
      expect(isReadOnlyStatement(sql), `${sql} is a read`).toBe(true);
    }
    for (const sql of [
      'INSERT INTO users VALUES (1)',
      'UPDATE users SET a = 1',
      'DELETE FROM users',
      'DROP TABLE users',
      'TRUNCATE users',
      'REPLACE INTO users VALUES (1)',
      'CALL some_proc()',
      // MySQL 8 allows a CTE to head a DELETE, so a `WITH` prefix is not proof of a read.
      'WITH doomed AS (SELECT id FROM users) DELETE FROM users WHERE id IN (SELECT id FROM doomed)',
    ]) {
      expect(isReadOnlyStatement(sql), `${sql} is NOT a read`).toBe(false);
    }
  });

  test('a hostile column reaches the identifier check through the where clause too', () => {
    expect(() => buildWhere({ 'id = 1 OR 1': 1 })).toThrow(/Unsafe SQL/);
  });

  test('an empty where produces no clause rather than a dangling WHERE', () => {
    expect(buildWhere({})).toEqual({ clause: '', values: [] });
  });
});

test.describe('concurrency validators are registered and gated @framework', () => {
  const NAMES = [
    'concurrency.read-consistency',
    'concurrency.burst-resilience',
    'concurrency.duplicate-write',
    'concurrency.session-isolation',
  ];

  test('every concurrency validator is registered under the concurrency toggle', () => {
    const registered = new Map(validationRegistry.all().map((v) => [v.name, v]));

    for (const name of NAMES) {
      const validator = registered.get(name);
      expect(validator, `${name} must be registered`).toBeDefined();
      expect(validator?.category, `${name} is a CONCURRENCY check`).toBe('CONCURRENCY');
      expect(
        validator?.toggle,
        `${name} must answer to validations.concurrency so an endpoint can switch it off`,
      ).toBe('concurrency');
      expect(validator?.stage, `${name} sends its own requests, so it is a probe`).toBe('probe');
    }
  });

  test.describe('against the API', () => {
    test.skip(!env.MOCK_API, 'drives real HTTP against the bundled mock');

    test('the read probes actually dispatch and report against a live server', async ({
      createValidationEngine,
    }) => {
      /*
       * The unit tests above prove the dispatcher and the comparators in isolation. This proves the
       * part they cannot: that the validators are reachable through the engine, survive a real
       * request/response cycle and return a verdict. A probe that throws on its first live exchange
       * would pass every test above and still be useless.
       */
      const report = await createValidationEngine({ onReport: undefined }).validate('get-user', {
        profile: 'FULL',
      });

      const readConsistency = report.results.find(
        (r) => r.validatorName === 'concurrency.read-consistency',
      );
      expect(readConsistency, 'the read-consistency probe ran').toBeDefined();
      expect(
        readConsistency?.status,
        `a consistent mock must not look like a race: ${readConsistency?.message}`,
      ).toBe('PASSED');

      const burst = report.results.find((r) => r.validatorName === 'concurrency.burst-resilience');
      expect(burst, 'the burst-resilience probe ran').toBeDefined();
      expect(burst?.status, `the mock served the burst: ${burst?.message}`).toBe('PASSED');
    });

    test('a write endpoint is skipped by the read probes with the reason attached', async ({
      createValidationEngine,
    }) => {
      const report = await createValidationEngine({ onReport: undefined }).validate('create-user', {
        profile: 'FULL',
      });

      const readConsistency = report.results.find(
        (r) => r.validatorName === 'concurrency.read-consistency',
      );
      expect(readConsistency?.status, 'a write is not a read-consistency subject').toBe('SKIPPED');
      expect(readConsistency?.message).toContain('duplicate-write');

      /*
       * And the duplicate-write probe skips too, because `create-user` does not declare
       * `singleWriteWins`. Both skipping is the correct outcome for an undeclared write — the point
       * is that each says which one it is rather than reporting a silent pass.
       */
      const duplicate = report.results.find(
        (r) => r.validatorName === 'concurrency.duplicate-write',
      );
      expect(duplicate?.status).toBe('SKIPPED');
      expect(duplicate?.message).toContain('singleWriteWins');
    });
  });
});
