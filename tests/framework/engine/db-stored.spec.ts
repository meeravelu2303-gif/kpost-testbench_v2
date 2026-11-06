import type { DatabaseClient } from '@database/database-client';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import { atOrAfter, expectStored } from '../../support/db-stored';

/**
 * `expectStored` (tests/support/db-stored.ts) is the data-integrity check every flow uses after a
 * write: a stored row as sent passes, a mismatch fails and is recorded as a finding, and a run with
 * no database says it did not check instead of passing.
 */
function fakeDb(row: Record<string, unknown> | undefined, enabled = true): DatabaseClient {
  return {
    enabled,
    suite: 'kpost-api',
    writable: false,
    findOne: () => Promise.resolve(row as never),
    findMany: () => Promise.resolve(row ? [row as never] : []),
    count: () => Promise.resolve(row ? 1 : 0),
  } as DatabaseClient;
}

const recorder = () => {
  const found: unknown[] = [];
  const executor = {
    recordBusinessRuleViolation: (v: unknown) => found.push(v),
  } as unknown as EndpointExecutor;
  return { found, executor };
};

const since = Date.now();

test.describe('expectStored · the data-integrity read-back @framework', () => {
  test('a row stored as sent passes (text, BLOB, flag and timestamp compare by value) @framework', async () => {
    const { found, executor } = recorder();
    await expectStored(
      fakeDb({
        title: Buffer.from('QA bench'),
        priority: 2,
        is_blocked: 1,
        modified_date: new Date(since + 1000),
      }),
      'kdiary-create-event',
      {
        table: 'TBL_KPOST_KDIARY_SCHEDULE',
        where: { event_id: 1 },
        columns: {
          title: 'QA bench',
          priority: '2',
          is_blocked: true,
          modified_date: atOrAfter(since),
        },
        rule: 'the event is stored as sent',
      },
      executor,
    );
    expect(found).toEqual([]);
    expect(test.info().annotations.at(-1)?.description).toContain('as sent');
  });

  test('a mismatch fails softly and is recorded as a finding @framework', async () => {
    test.fail(true, 'the soft failure is the behaviour under test');
    const { found, executor } = recorder();
    await expectStored(
      fakeDb({ title: 'something else' }),
      'kdiary-create-event',
      {
        table: 'TBL_KPOST_KDIARY_SCHEDULE',
        where: { event_id: 1 },
        columns: { title: 'QA bench' },
        rule: 'the event is stored as sent',
      },
      executor,
    );
    expect(found).toHaveLength(1);
  });

  test('a timestamp the backend wrote in UTC still counts as "after the call" @framework', () => {
    // Read as local time, a UTC-written value looks an offset earlier than it is.
    const offsetMs = -new Date().getTimezoneOffset() * 60_000;
    expect(atOrAfter(since)(new Date(since + 1000 - offsetMs))).toBe(true);
    expect(atOrAfter(since)(new Date(since - 24 * 3_600_000)), 'a day before is not after').toBe(
      false,
    );
  });

  test('a failing secret column never prints its value @framework', async () => {
    test.fail(true, 'the soft failure is the behaviour under test');
    const { found, executor } = recorder();
    await expectStored(
      fakeDb({ access_code: 'QA-SECRET-1234' }),
      'signup-login-set-access-code',
      {
        table: 'TBL_KPOST_USER_PROFILE',
        where: { kpost_id: 'x' },
        columns: { access_code: 'something-else' },
        rule: 'r',
      },
      executor,
    );
    expect(JSON.stringify(found)).not.toContain('QA-SECRET-1234');
    expect(JSON.stringify(test.info().annotations)).not.toContain('QA-SECRET-1234');
    expect(found).toHaveLength(1);
  });

  test('a delete passes only when the row is gone @framework', async () => {
    const { found, executor } = recorder();
    await expectStored(
      fakeDb(undefined),
      'kdiary-delete-report',
      {
        table: 'TBL_KPOST_KDIARY_REPORT',
        where: { id: 1 },
        absent: true,
        rule: 'the report is gone',
      },
      executor,
    );
    expect(found).toEqual([]);
  });

  test('with no database it says it did not check, and judges nothing @framework', async () => {
    const { found, executor } = recorder();
    await expectStored(
      fakeDb({ title: 'anything' }, false),
      'kdiary-create-event',
      { table: 'T', where: { id: 1 }, columns: { title: 'QA bench' }, rule: 'r' },
      executor,
    );
    expect(found).toEqual([]);
    expect(test.info().annotations.map((a) => a.type)).toContain('db-not-checked');
  });
});
