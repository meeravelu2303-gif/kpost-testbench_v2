import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  DuplicateResourceError,
  FileResourceJournal,
  findOrphans,
  InvalidResourceTransitionError,
  readJournalFile,
  readJournalText,
  ResourceLedger,
  ResourceLedgerError,
  UnknownResourceError,
  allowedTransitionsFrom,
  canTransition,
  resourceKey,
  type ResourceEvent,
  type ResourceOwner,
  type ResourceRecord,
} from '../../src/test-data/index';
import { expect, test } from '@fixtures';

/**
 * Guards for Phase 2 §17.4 — the resource ledger and the durable journal.
 *
 * Entirely offline. The ledger performs no cleanup and calls nothing; journal files are written to a
 * fresh temp directory per test, so a developer's `reports/resources.jsonl` is never read or written.
 */

const OWNER: ResourceOwner = {
  runId: 'run-aaaa1111',
  testCaseId: 'TC-API-kpost-api-katchup-send-message-response.status-code',
  slot: 0,
};

/** A ledger with an in-memory journal, so events can be asserted without touching disk. */
function ledgerWithEvents(owner: ResourceOwner = OWNER): {
  ledger: ResourceLedger;
  events: ResourceEvent[];
} {
  const events: ResourceEvent[] = [];
  let tick = 0;
  const ledger = new ResourceLedger({
    owner,
    journal: { append: (event) => events.push(event) },
    now: () => new Date(Date.UTC(2026, 8, 20, 0, 0, tick++)),
  });
  return { ledger, events };
}

/** A temp directory that the test removes afterwards. */
function tempJournal(): { file: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'kpost-journal-'));
  return {
    file: path.join(dir, 'resources.jsonl'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test.describe('resource ledger: registration @framework', () => {
  test('registers a resource with full ownership and an initial state', () => {
    const { ledger, events } = ledgerWithEvents();
    const record = ledger.register({ kind: 'katchup-message', id: 4211, describe: 'QA subject' });

    expect(record.runId).toBe(OWNER.runId);
    expect(record.testCaseId).toBe(OWNER.testCaseId);
    expect(record.slot).toBe(0);
    expect(record.kind).toBe('katchup-message');
    expect(record.id, 'a numeric id is stored as a string').toBe('4211');
    expect(record.describe).toBe('QA subject');
    expect(record.registeredAt).toBe('2026-09-20T00:00:00.000Z');
    expect(record.state).toBe('REGISTERED');
    expect(record.cleanupResult).toBeNull();
    expect(record.updatedAt).toBeNull();

    // Durable BEFORE the test continues: a crash one line later still leaves it identifiable.
    expect(events).toHaveLength(1);
    expect(events[0]?.event).toBe('registered');
  });

  test('track() is register(), and several resources coexist', () => {
    const { ledger } = ledgerWithEvents();
    ledger.track({ kind: 'katchup-message', id: 1 });
    ledger.track({ kind: 'group', id: 'g-9' });
    ledger.track({ kind: 'kall', id: 77 });

    expect(ledger.count()).toBe(3);
    expect(
      ledger
        .list()
        .map((r) => r.kind)
        .sort(),
    ).toEqual(['group', 'kall', 'katchup-message']);
    expect(ledger.has({ kind: 'group', id: 'g-9' })).toBe(true);
    expect(ledger.has({ kind: 'group', id: 'nope' })).toBe(false);
    expect(ledger.get({ kind: 'kall', id: 77 })?.state).toBe('REGISTERED');
  });

  test('a default description names the resource rather than inventing one', () => {
    const { ledger } = ledgerWithEvents();
    expect(ledger.register({ kind: 'group', id: 'g-1' }).describe).toBe('group g-1');
  });

  test('queries by run, test case and slot', () => {
    const { ledger } = ledgerWithEvents();
    ledger.register({ kind: 'a', id: '1' });
    ledger.register({ kind: 'b', id: '2', owner: { testCaseId: 'TC-UI-other-1234AB' } });
    ledger.register({ kind: 'c', id: '3', owner: { slot: 1 } });

    expect(ledger.getByRun(OWNER.runId)).toHaveLength(3);
    expect(ledger.getByTestCase(OWNER.testCaseId).map((r) => r.kind)).toEqual(['a', 'c']);
    expect(ledger.getByTestCase('TC-UI-other-1234AB').map((r) => r.kind)).toEqual(['b']);
    expect(ledger.getBySlot(0).map((r) => r.kind)).toEqual(['a', 'b']);
    expect(ledger.getBySlot(1).map((r) => r.kind)).toEqual(['c']);
  });

  test('a resource with no account owner states that explicitly', () => {
    const { ledger } = ledgerWithEvents({ ...OWNER, slot: null });
    const record = ledger.register({ kind: 's3-object', id: 'uuid-1' });
    expect(record.slot, 'null means "no account slot", never an invented 0').toBeNull();
    expect(ledger.getBySlot(null)).toHaveLength(1);
  });

  test('the stable testCaseId is the correlation key — never validationId', () => {
    const { ledger, events } = ledgerWithEvents();
    ledger.register({ kind: 'katchup-message', id: 1 });
    expect(events[0]?.testCaseId).toMatch(/^TC-/);
    expect(JSON.stringify(events[0])).not.toContain('validationId');
  });
});

test.describe('resource ledger: duplicate protection @framework', () => {
  test('registering the same identity twice throws and names the existing record', () => {
    const { ledger } = ledgerWithEvents();
    ledger.register({ kind: 'katchup-message', id: 1, describe: 'first' });

    let error: unknown;
    try {
      ledger.register({ kind: 'katchup-message', id: 1, describe: 'second' });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(DuplicateResourceError);
    expect(error).toBeInstanceOf(ResourceLedgerError);
    expect((error as DuplicateResourceError).existing.describe, 'the original is preserved').toBe(
      'first',
    );
    expect((error as Error).message).toContain('already registered');
    // The ledger is not corrupted: one record, still the first.
    expect(ledger.count()).toBe(1);
    expect(ledger.get({ kind: 'katchup-message', id: 1 })?.describe).toBe('first');
  });

  test('the same resource id in a different test case is a different resource', () => {
    const { ledger } = ledgerWithEvents();
    ledger.register({ kind: 'katchup-message', id: 1 });
    expect(() =>
      ledger.register({ kind: 'katchup-message', id: 1, owner: { testCaseId: 'TC-API-other' } }),
    ).not.toThrow();
    expect(ledger.count()).toBe(2);
  });

  test('the same resource id in a different slot or run does not collide', () => {
    const { ledger } = ledgerWithEvents();
    ledger.register({ kind: 'katchup-message', id: 1 });
    ledger.register({ kind: 'katchup-message', id: 1, owner: { slot: 1 } });
    ledger.register({ kind: 'katchup-message', id: 1, owner: { runId: 'run-bbbb2222' } });
    expect(ledger.count()).toBe(3);

    const keys = ledger.list().map((record) => resourceKey(record));
    expect(new Set(keys).size, 'every identity is distinct').toBe(3);
  });

  test('changing the state of an unregistered resource fails clearly', () => {
    const { ledger } = ledgerWithEvents();
    expect(() => ledger.markCleanupPending({ kind: 'group', id: 'g-1' })).toThrow(
      UnknownResourceError,
    );
    expect(() => ledger.markCleanupPending({ kind: 'group', id: 'g-1' })).toThrow(
      /Register it before changing its state/,
    );
  });
});

test.describe('resource ledger: state machine @framework', () => {
  test('the happy path: REGISTERED → CLEANUP_PENDING → CLEANED', () => {
    const { ledger, events } = ledgerWithEvents();
    const resource = { kind: 'katchup-message', id: 1 };
    ledger.register(resource);
    expect(ledger.markCleanupPending(resource).state).toBe('CLEANUP_PENDING');

    const cleaned = ledger.markCleanupSucceeded(resource, 'deleted (204)');
    expect(cleaned.state).toBe('CLEANED');
    expect(cleaned.cleanupResult).toBe('deleted (204)');
    expect(cleaned.updatedAt).not.toBeNull();
    expect(events.map((event) => event.state)).toEqual([
      'REGISTERED',
      'CLEANUP_PENDING',
      'CLEANED',
    ]);
  });

  test('a failed cleanup stays visible with its reason', () => {
    const { ledger } = ledgerWithEvents();
    const resource = { kind: 'group', id: 'g-1' };
    ledger.register(resource);
    ledger.markCleanupPending(resource);

    const failed = ledger.markCleanupFailed(resource, 'HTTP 500 on delete');
    expect(failed.state).toBe('CLEANUP_FAILED');
    expect(failed.cleanupResult, 'the reason is never swallowed').toBe('HTTP 500 on delete');
    expect(ledger.count('CLEANUP_FAILED')).toBe(1);
    expect(ledger.outstanding()).toHaveLength(1);
  });

  test('a failed cleanup may be retried, and can then succeed', () => {
    const { ledger } = ledgerWithEvents();
    const resource = { kind: 'group', id: 'g-1' };
    ledger.register(resource);
    ledger.markCleanupPending(resource);
    ledger.markCleanupFailed(resource, 'HTTP 500');
    expect(ledger.markCleanupPending(resource).state).toBe('CLEANUP_PENDING');
    expect(ledger.markCleanupSucceeded(resource).state).toBe('CLEANED');
  });

  test('nonsensical transitions are refused, naming what is allowed', () => {
    const { ledger } = ledgerWithEvents();
    const resource = { kind: 'katchup-message', id: 1 };
    ledger.register(resource);

    // REGISTERED → CLEANED skips the pending record that makes an interrupted attempt visible.
    expect(() => ledger.markCleanupSucceeded(resource)).toThrow(InvalidResourceTransitionError);
    expect(() => ledger.markCleanupSucceeded(resource)).toThrow(/REGISTERED → CLEANED/);
    expect(() => ledger.markCleanupFailed(resource, 'x')).toThrow(InvalidResourceTransitionError);

    ledger.markCleanupPending(resource);
    ledger.markCleanupSucceeded(resource);
    // CLEANED is terminal: a deleted resource cannot become pending again.
    expect(() => ledger.markCleanupPending(resource)).toThrow(/terminal/);
    expect(ledger.get(resource)?.state, 'the record is unchanged by a refused transition').toBe(
      'CLEANED',
    );
  });

  test('the transition table is the single authority', () => {
    expect(canTransition('REGISTERED', 'CLEANUP_PENDING')).toBe(true);
    expect(canTransition('REGISTERED', 'CLEANED')).toBe(false);
    expect(canTransition('CLEANUP_PENDING', 'CLEANED')).toBe(true);
    expect(canTransition('CLEANUP_PENDING', 'CLEANUP_FAILED')).toBe(true);
    expect(canTransition('CLEANUP_FAILED', 'CLEANUP_PENDING')).toBe(true);
    expect(allowedTransitionsFrom('CLEANED')).toEqual([]);
  });
});

test.describe('resource journal: durability @framework', () => {
  test('appends one JSON line per event and never rewrites the file', () => {
    const { file, cleanup } = tempJournal();
    try {
      const ledger = new ResourceLedger({ owner: OWNER, journal: new FileResourceJournal(file) });
      const resource = { kind: 'katchup-message', id: 1 };
      ledger.register(resource);
      const afterRegister = readFileSync(file, 'utf8');

      ledger.markCleanupPending(resource);
      ledger.markCleanupSucceeded(resource, 'deleted');
      const text = readFileSync(file, 'utf8');

      expect(text.trim().split('\n')).toHaveLength(3);
      expect(text.startsWith(afterRegister), 'earlier events are never rewritten').toBe(true);
      expect(text.endsWith('\n')).toBe(true);
    } finally {
      cleanup();
    }
  });

  test('reconstructs current state from the journal', () => {
    const { file, cleanup } = tempJournal();
    try {
      const ledger = new ResourceLedger({ owner: OWNER, journal: new FileResourceJournal(file) });
      ledger.register({ kind: 'katchup-message', id: 1, describe: 'kept' });
      ledger.register({ kind: 'group', id: 'g-1' });
      ledger.markCleanupPending({ kind: 'group', id: 'g-1' });
      ledger.markCleanupSucceeded({ kind: 'group', id: 'g-1' }, 'deleted');

      const result = readJournalFile(file);
      expect(result.issues).toEqual([]);
      expect(result.eventsRead).toBe(4);
      expect(result.records).toHaveLength(2);
      const byKind = Object.fromEntries(result.records.map((r) => [r.kind, r]));
      expect(byKind['katchup-message']?.state).toBe('REGISTERED');
      expect(byKind['katchup-message']?.describe).toBe('kept');
      expect(byKind.group?.state).toBe('CLEANED');
      expect(byKind.group?.cleanupResult).toBe('deleted');
    } finally {
      cleanup();
    }
  });

  test('a missing journal is an empty journal, not an error', () => {
    const { file, cleanup } = tempJournal();
    try {
      expect(readJournalFile(file).records).toEqual([]);
    } finally {
      cleanup();
    }
  });
});

test.describe('resource journal: recovery and orphans @framework', () => {
  const event = (over: Partial<ResourceEvent>): string =>
    JSON.stringify({
      event: 'registered',
      eventAt: '2026-09-20T00:00:00.000Z',
      runId: OWNER.runId,
      testCaseId: OWNER.testCaseId,
      slot: 0,
      kind: 'katchup-message',
      id: '1',
      describe: 'QA subject',
      registeredAt: '2026-09-20T00:00:00.000Z',
      state: 'REGISTERED',
      cleanupResult: null,
      ...over,
    });

  test('a journal that ends after REGISTERED marks the resource never-cleaned', () => {
    const result = readJournalText(`${event({})}\n`);
    const orphans = findOrphans(result.records);
    expect(orphans.neverCleaned).toHaveLength(1);
    expect(orphans.candidates).toHaveLength(1);
    expect(orphans.cleaned).toHaveLength(0);
  });

  test('a journal that ends after CLEANUP_PENDING marks it pending', () => {
    const text = [event({}), event({ event: 'transition', state: 'CLEANUP_PENDING' })].join('\n');
    const orphans = findOrphans(readJournalText(`${text}\n`).records);
    expect(orphans.pending).toHaveLength(1);
    expect(orphans.neverCleaned).toHaveLength(0);
  });

  test('a journal that ends after CLEANUP_FAILED keeps the failure visible', () => {
    const text = [
      event({}),
      event({ event: 'transition', state: 'CLEANUP_PENDING' }),
      event({ event: 'transition', state: 'CLEANUP_FAILED', cleanupResult: 'HTTP 500' }),
    ].join('\n');
    const orphans = findOrphans(readJournalText(`${text}\n`).records);
    expect(orphans.failed).toHaveLength(1);
    expect(orphans.failed[0]?.cleanupResult).toBe('HTTP 500');
  });

  test('a journal that ends after CLEANED leaves no candidate', () => {
    const text = [
      event({}),
      event({ event: 'transition', state: 'CLEANUP_PENDING' }),
      event({ event: 'transition', state: 'CLEANED', cleanupResult: 'deleted' }),
    ].join('\n');
    const orphans = findOrphans(readJournalText(`${text}\n`).records);
    expect(orphans.candidates).toEqual([]);
    expect(orphans.cleaned).toHaveLength(1);
  });

  test('a killed process leaves a truncated final line, and everything before it survives', () => {
    // The crash signature: the last write never finished.
    const text = `${event({})}\n${event({ kind: 'group', id: 'g-1' }).slice(0, 40)}`;
    const result = readJournalText(text);
    expect(result.truncatedFinalLine).toBe(true);
    expect(result.records, 'the completed event is still readable').toHaveLength(1);
    expect(result.issues, 'a truncated tail is expected, not corruption').toEqual([]);
  });

  test('corruption is surfaced, never silently hidden', () => {
    const text = [
      event({}),
      'this is not json',
      JSON.stringify({ runId: 'r', kind: 'k' }), // missing fields
      event({ kind: 'group', id: 'g-2', state: 'NONSENSE' as never }),
      event({}), // duplicate registration
      event({ event: 'transition', kind: 'never-registered', id: 'x', state: 'CLEANUP_PENDING' }),
      event({ event: 'transition', state: 'CLEANED' }), // REGISTERED → CLEANED is illegal
    ].join('\n');
    const result = readJournalText(`${text}\n`);

    expect(result.issues.map((issue) => issue.reason)).toEqual([
      'malformed-json',
      'missing-fields',
      'unknown-state',
      'duplicate-registration',
      'transition-before-registration',
      'invalid-transition',
    ]);
    // Each issue names its line, so a human can find it.
    expect(result.issues.every((issue) => issue.line > 0)).toBe(true);
    // The valid resource is still reconstructed.
    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.state).toBe('REGISTERED');
  });
});

test.describe('resource journal: credential safety @framework', () => {
  const SECRETS = [
    'hunter2-not-a-real-password',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJxYSJ9.c2lnbmF0dXJl',
    'Bearer abcdef0123456789',
    'sessionid=abc123; HttpOnly',
    'refresh-token-9f8e7d6c',
    'sk_test_51H8yNotARealKey',
  ];

  test('secrets in a description never reach the journal', () => {
    const { ledger, events } = ledgerWithEvents();
    for (const [index, secret] of SECRETS.entries()) {
      ledger.register({
        kind: 'katchup-message',
        id: index,
        describe: `created with password=${secret} token=${secret}`,
      });
    }
    const serialized = JSON.stringify(events);
    for (const secret of SECRETS) {
      expect(serialized, `"${secret.slice(0, 12)}…" must not be persisted`).not.toContain(secret);
    }
  });

  test('secrets in a cleanup reason never reach the journal', () => {
    const { ledger, events } = ledgerWithEvents();
    const resource = { kind: 'group', id: 'g-1' };
    ledger.register(resource);
    ledger.markCleanupPending(resource);
    ledger.markCleanupFailed(resource, `delete failed, authorization: Bearer ${SECRETS[1]}`);

    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(SECRETS[1]);
    expect(serialized).toContain('***');
  });

  test('a journal file on disk contains no secret', () => {
    const { file, cleanup } = tempJournal();
    try {
      const ledger = new ResourceLedger({ owner: OWNER, journal: new FileResourceJournal(file) });
      ledger.register({
        kind: 'katchup-message',
        id: 1,
        describe: `qa@example.invalid password=${SECRETS[0]}`,
      });
      const text = readFileSync(file, 'utf8');
      for (const secret of SECRETS) expect(text).not.toContain(secret);
    } finally {
      cleanup();
    }
  });

  test('a malformed line is masked before it is reported', () => {
    const result = readJournalText(`{"broken": "password=${SECRETS[0]}"\n`);
    expect(JSON.stringify(result.issues)).not.toContain(SECRETS[0]);
  });
});

test.describe('resource journal: isolation @framework', () => {
  test('two runs writing similar ids stay distinct through reconstruction', () => {
    const line = (runId: string, state: string): string =>
      JSON.stringify({
        event: state === 'REGISTERED' ? 'registered' : 'transition',
        eventAt: '2026-09-20T00:00:00.000Z',
        runId,
        testCaseId: OWNER.testCaseId,
        slot: 0,
        kind: 'katchup-message',
        id: '1',
        describe: 'same id, different run',
        registeredAt: '2026-09-20T00:00:00.000Z',
        state,
        cleanupResult: null,
      });

    const result = readJournalText(
      [
        line('run-A', 'REGISTERED'),
        line('run-B', 'REGISTERED'),
        line('run-B', 'CLEANUP_PENDING'),
        '',
      ].join('\n'),
    );
    expect(result.issues).toEqual([]);
    expect(result.records).toHaveLength(2);
    const byRun = Object.fromEntries(result.records.map((r: ResourceRecord) => [r.runId, r.state]));
    expect(byRun['run-A'], 'run A is untouched by run B').toBe('REGISTERED');
    expect(byRun['run-B']).toBe('CLEANUP_PENDING');
  });

  test('slot 0 and slot 1 resources with the same id are two records', () => {
    const { ledger } = ledgerWithEvents();
    ledger.register({ kind: 'katchup-message', id: 1 });
    ledger.register({ kind: 'katchup-message', id: 1, owner: { slot: 1 } });
    ledger.markCleanupPending({ kind: 'katchup-message', id: 1, owner: { slot: 1 } });

    expect(ledger.getBySlot(0)[0]?.state, 'slot 0 is unaffected').toBe('REGISTERED');
    expect(ledger.getBySlot(1)[0]?.state).toBe('CLEANUP_PENDING');
  });
});

test.describe('resource ledger: separation of concerns @framework', () => {
  test('the ledger RECORDS cleanup but never PERFORMS it', () => {
    /*
     * Phase 2.4 is TRACK only. `markCleanup*` record what happened to a resource; there is
     * deliberately no method that deletes one, sweeps the journal, or calls a target — that is the
     * later cleanup phase, which needs its own safety review.
     */
    const ledger = new ResourceLedger({ owner: OWNER });
    const api = Object.getOwnPropertyNames(Object.getPrototypeOf(ledger) as object);

    expect(api, 'state recorders exist').toEqual(
      expect.arrayContaining(['markCleanupPending', 'markCleanupSucceeded', 'markCleanupFailed']),
    );
    for (const verb of ['delete', 'destroy', 'remove', 'sweep', 'purge', 'execute', 'perform']) {
      const offenders = api.filter((name) => name.toLowerCase().includes(verb));
      expect(offenders, `no method performs "${verb}"`).toEqual([]);
    }
  });

  test('ledger failures are infrastructure errors, distinct from assertion failures', () => {
    expect(new ResourceLedgerError('x').name).toBe('ResourceLedgerError');
    expect(new UnknownResourceError('x')).toBeInstanceOf(ResourceLedgerError);
    expect(new InvalidResourceTransitionError('CLEANED', 'CLEANED', 'x').name).toBe(
      'InvalidResourceTransitionError',
    );
  });

  test('a ledger with no journal is inert — nothing is written anywhere', () => {
    const { file, cleanup } = tempJournal();
    try {
      writeFileSync(file, '');
      const ledger = new ResourceLedger({ owner: OWNER });
      ledger.register({ kind: 'katchup-message', id: 1 });
      expect(readFileSync(file, 'utf8'), 'the default sink discards events').toBe('');
      expect(ledger.count()).toBe(1);
    } finally {
      cleanup();
    }
  });
});
