import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  CleanupCoordinator,
  CleanupRegistry,
  FileResourceJournal,
  ResourceLedger,
  findOrphans,
  readJournalFile,
  type CleanupSummary,
  type ResourceOwner,
} from '../../src/test-data/index';
import { expect, test } from '@fixtures';

/**
 * Guards for Phase 2 §17.5 — the cleanup framework.
 *
 * Entirely offline: cleanup operations here are plain functions, so nothing contacts a host. The
 * invariant under test is structural — **a tracked resource gets a cleanup attempt whatever the test
 * body did** — plus the rule that a cleanup failure is reported, never swallowed and never treated as
 * an application defect.
 */

const OWNER: ResourceOwner = {
  runId: 'run-cleanup-1',
  testCaseId: 'TC-API-kpost-api-katchup-send-message-response.status-code',
  slot: 0,
};

function coordinator(owner: ResourceOwner = OWNER): CleanupCoordinator {
  return new CleanupCoordinator({ ledger: new ResourceLedger({ owner }) });
}

function tempJournal(): { file: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'kpost-cleanup-'));
  return {
    file: path.join(dir, 'resources.jsonl'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/**
 * The fixture contract, simulated: the body runs (and may throw), then cleanup runs regardless —
 * exactly what `resources` does in `src/fixtures/index.ts`.
 */
async function runTest(
  body: (resources: CleanupCoordinator) => Promise<void> | void,
  resources: CleanupCoordinator = coordinator(),
): Promise<{ bodyError: unknown; summary: CleanupSummary; resources: CleanupCoordinator }> {
  let bodyError: unknown;
  try {
    await body(resources);
  } catch (error) {
    bodyError = error;
  }
  const summary = await resources.cleanupAll();
  return { bodyError, summary, resources };
}

test.describe('cleanup: guaranteed execution @framework', () => {
  test('a passing test still gets its resources cleaned', async () => {
    const deleted: string[] = [];
    const { summary } = await runTest((resources) => {
      resources.track({ kind: 'katchup-message', id: 1, cleanup: () => deleted.push('1') });
    });
    expect(deleted).toEqual(['1']);
    expect(summary.status).toBe('SUCCESS');
    expect(summary).toMatchObject({ registered: 1, attempted: 1, cleaned: 1, failed: 0 });
  });

  test('a FAILED ASSERTION does not skip cleanup', async () => {
    const deleted: string[] = [];
    const { bodyError, summary } = await runTest((resources) => {
      resources.track({ kind: 'katchup-message', id: 1, cleanup: () => deleted.push('1') });
      // The old pattern put the delete after this line, so it never ran.
      expect(1, 'a deliberate failure').toBe(2);
    });
    expect(bodyError, 'the assertion still failed').toBeTruthy();
    expect(deleted, 'and the resource was still cleaned').toEqual(['1']);
    expect(summary.cleaned).toBe(1);
  });

  test('a THROWN error does not skip cleanup', async () => {
    const deleted: string[] = [];
    const { bodyError, summary } = await runTest((resources) => {
      resources.track({ kind: 'group', id: 'g-1', cleanup: () => deleted.push('g-1') });
      throw new Error('the API call blew up');
    });
    expect((bodyError as Error).message).toBe('the API call blew up');
    expect(deleted).toEqual(['g-1']);
    expect(summary.status).toBe('SUCCESS');
  });

  test('a test that creates several resources cleans all of them after a mid-flow failure', async () => {
    const deleted: string[] = [];
    const { summary } = await runTest((resources) => {
      resources.track({ kind: 'k', id: 'a', cleanup: () => deleted.push('a') });
      resources.track({ kind: 'k', id: 'b', cleanup: () => deleted.push('b') });
      throw new Error('failed before the third was created');
    });
    expect(deleted.sort()).toEqual(['a', 'b']);
    expect(summary).toMatchObject({ registered: 2, cleaned: 2, failed: 0 });
  });

  test('a test that tracked nothing reports NOT_REQUIRED', async () => {
    const { summary } = await runTest(() => undefined);
    expect(summary.status).toBe('NOT_REQUIRED');
    expect(summary.registered).toBe(0);
  });

  test('a resource whose creation failed is never registered, so nothing is attempted', async () => {
    const { summary } = await runTest((resources) => {
      const created: { id?: number } = {};
      // The real pattern: register only when creation produced an id.
      if (created.id !== undefined) resources.track({ kind: 'k', id: created.id });
    });
    expect(summary.status).toBe('NOT_REQUIRED');
  });
});

test.describe('cleanup: LIFO order @framework', () => {
  test('A, B, C are cleaned C, B, A', async () => {
    const order: string[] = [];
    const { summary } = await runTest((resources) => {
      resources.track({ kind: 'k', id: 'A', cleanup: () => order.push('A') });
      resources.track({ kind: 'k', id: 'B', cleanup: () => order.push('B') });
      resources.track({ kind: 'k', id: 'C', cleanup: () => order.push('C') });
    });
    // Reverse order matters: a member must go before its group, a message before its thread.
    expect(order).toEqual(['C', 'B', 'A']);
    expect(summary.cleaned).toBe(3);
  });

  test('registration order is preserved for reporting', () => {
    const resources = coordinator();
    resources.track({ kind: 'k', id: 'A' });
    resources.track({ kind: 'k', id: 'B' });
    expect(resources.tracked().map((record) => record.id)).toEqual(['A', 'B']);
  });

  test('one failure does not stop the rest from being cleaned', async () => {
    const order: string[] = [];
    const { summary } = await runTest((resources) => {
      resources.track({ kind: 'k', id: 'A', cleanup: () => order.push('A') });
      resources.track({
        kind: 'k',
        id: 'B',
        cleanup: () => {
          throw new Error('delete B failed');
        },
      });
      resources.track({ kind: 'k', id: 'C', cleanup: () => order.push('C') });
    });
    expect(order, 'A and C are still cleaned').toEqual(['C', 'A']);
    expect(summary).toMatchObject({ registered: 3, attempted: 3, cleaned: 2, failed: 1 });
    expect(summary.status).toBe('FAILED');
    expect(summary.failures[0]?.id).toBe('B');
  });
});

test.describe('cleanup: state transitions @framework', () => {
  test('a successful cleanup walks REGISTERED → CLEANUP_PENDING → CLEANED', async () => {
    const { file, cleanup } = tempJournal();
    try {
      const ledger = new ResourceLedger({ owner: OWNER, journal: new FileResourceJournal(file) });
      const resources = new CleanupCoordinator({ ledger });
      await runTest((r) => {
        r.track({ kind: 'katchup-message', id: 1, cleanup: () => 204 });
      }, resources);

      const states = readFileSync(file, 'utf8')
        .trim()
        .split('\n')
        .map((line) => (JSON.parse(line) as { state: string }).state);
      expect(states).toEqual(['REGISTERED', 'CLEANUP_PENDING', 'CLEANED']);
      expect(ledger.get({ kind: 'katchup-message', id: 1 })?.cleanupResult).toBe('deleted (204)');
    } finally {
      cleanup();
    }
  });

  test('a failed cleanup walks REGISTERED → CLEANUP_PENDING → CLEANUP_FAILED', async () => {
    const { file, cleanup } = tempJournal();
    try {
      const ledger = new ResourceLedger({ owner: OWNER, journal: new FileResourceJournal(file) });
      const resources = new CleanupCoordinator({ ledger });
      await runTest((r) => {
        r.track({
          kind: 'group',
          id: 'g-1',
          cleanup: () => {
            throw new Error('HTTP 500 on delete');
          },
        });
      }, resources);

      const events = readJournalFile(file);
      expect(events.records[0]?.state).toBe('CLEANUP_FAILED');
      expect(events.records[0]?.cleanupResult).toContain('HTTP 500 on delete');
      // The Phase 2.4 recovery view sees it as a candidate — evidence, not a deletion.
      expect(findOrphans(events.records).failed).toHaveLength(1);
    } finally {
      cleanup();
    }
  });

  test('the coordinator never mutates state directly — every change goes through the ledger', async () => {
    const resources = coordinator();
    const record = resources.track({ kind: 'k', id: '1', cleanup: () => undefined });
    // The record handed back is a snapshot; the ledger holds the authoritative state.
    await resources.cleanupAll();
    expect(record.state, 'the snapshot is not retro-edited').toBe('REGISTERED');
    expect(resources.ledger.get({ kind: 'k', id: '1' })?.state).toBe('CLEANED');
  });

  test('an already-cleaned resource is never deleted a second time', async () => {
    let calls = 0;
    const resources = coordinator();
    resources.track({
      kind: 'k',
      id: '1',
      cleanup: () => {
        calls += 1;
      },
    });
    await resources.cleanupAll();
    await resources.cleanupAll();
    expect(calls, 'the second pass issues no delete').toBe(1);
  });

  test('a failed cleanup may be retried (the state machine allows it) and then succeed', async () => {
    let attempt = 0;
    const resources = coordinator();
    resources.track({
      kind: 'k',
      id: '1',
      cleanup: () => {
        attempt += 1;
        if (attempt === 1) throw new Error('transient');
      },
    });
    const first = await resources.cleanupAll();
    expect(first.failed).toBe(1);

    // Nothing retries automatically — a later recovery pass would call this deliberately.
    await resources.cleanupOne({ ...OWNER, kind: 'k', id: '1' });
    expect(resources.ledger.get({ kind: 'k', id: '1' })?.state).toBe('CLEANED');
    expect(attempt).toBe(2);
  });
});

test.describe('cleanup: failure visibility @framework', () => {
  test('a cleanup failure is reported with structured, actionable evidence', async () => {
    const { summary } = await runTest((resources) => {
      resources.track({
        kind: 'katchup-message',
        id: 77,
        cleanup: () => {
          throw new Error('HTTP 500');
        },
      });
    });
    expect(summary.failures).toHaveLength(1);
    expect(summary.failures[0]).toMatchObject({
      kind: 'katchup-message',
      id: '77',
      testCaseId: OWNER.testCaseId,
      runId: OWNER.runId,
      slot: 0,
      operation: 'inline',
      category: 'operation-threw',
    });
    expect(summary.failures[0]?.message).toContain('HTTP 500');
  });

  test('a resource with no cleanup operation is reported, not silently forgotten', async () => {
    const { summary } = await runTest((resources) => {
      resources.track({ kind: 'mystery-thing', id: 'x' });
    });
    expect(summary.status).toBe('FAILED');
    expect(summary.failures[0]?.category).toBe('no-handler');
    expect(summary.failures[0]?.message).toContain('mystery-thing');
  });

  test('a kind-level handler serves every resource of that kind', async () => {
    const deleted: string[] = [];
    const registry = new CleanupRegistry().register({
      kind: 'katchup-message',
      cleanup: (record) => deleted.push(record.id),
    });
    const resources = new CleanupCoordinator({
      ledger: new ResourceLedger({ owner: OWNER }),
      registry,
    });
    resources.track({ kind: 'katchup-message', id: '1' });
    resources.track({ kind: 'katchup-message', id: '2' });
    const summary = await resources.cleanupAll();

    expect(deleted).toEqual(['2', '1']);
    expect(summary.failures, 'a registered handler serves the kind').toEqual([]);
    expect(summary.cleaned).toBe(2);
  });

  test('failures reach an observer as they happen', async () => {
    const seen: string[] = [];
    const resources = new CleanupCoordinator({
      ledger: new ResourceLedger({ owner: OWNER }),
      onFailure: (failure) => seen.push(`${failure.kind}:${failure.category}`),
    });
    resources.track({ kind: 'k', id: '1' });
    await resources.cleanupAll();
    expect(seen).toEqual(['k:no-handler']);
  });
});

test.describe('cleanup: functional status vs cleanup status @framework', () => {
  test('the two dimensions are independent in all four combinations', async () => {
    const ok = () => undefined;
    const boom = (): never => {
      throw new Error('delete failed');
    };

    // PASS + SUCCESS
    const a = await runTest((r) => {
      r.track({ kind: 'k', id: '1', cleanup: ok });
    });
    expect([a.bodyError, a.summary.status]).toEqual([undefined, 'SUCCESS']);

    // PASS + FAILED — a passing feature whose delete failed is still a passing feature.
    const b = await runTest((r) => {
      r.track({ kind: 'k', id: '1', cleanup: boom });
    });
    expect([b.bodyError, b.summary.status]).toEqual([undefined, 'FAILED']);

    // FAIL + SUCCESS
    const c = await runTest((r) => {
      r.track({ kind: 'k', id: '1', cleanup: ok });
      throw new Error('functional failure');
    });
    expect([(c.bodyError as Error).message, c.summary.status]).toEqual([
      'functional failure',
      'SUCCESS',
    ]);

    // FAIL + FAILED
    const d = await runTest((r) => {
      r.track({ kind: 'k', id: '1', cleanup: boom });
      throw new Error('functional failure');
    });
    expect([(d.bodyError as Error).message, d.summary.status]).toEqual([
      'functional failure',
      'FAILED',
    ]);
  });

  test('cleanupAll never throws, so it cannot replace the test verdict', async () => {
    const resources = coordinator();
    resources.track({
      kind: 'k',
      id: '1',
      cleanup: () => {
        throw new Error('boom');
      },
    });
    await expect(resources.cleanupAll()).resolves.toMatchObject({ status: 'FAILED' });
  });
});

test.describe('cleanup: ownership @framework', () => {
  const foreign = { runId: 'run-other', testCaseId: 'TC-API-other', slot: 1 };

  test('a resource owned by another run, test case or slot is REFUSED', async () => {
    for (const [label, owner] of [
      ['run', { ...OWNER, runId: foreign.runId }],
      ['test case', { ...OWNER, testCaseId: foreign.testCaseId }],
      ['slot', { ...OWNER, slot: foreign.slot }],
    ] as const) {
      let deleted = false;
      const resources = coordinator();
      // Registered under a DIFFERENT owner than the ledger's: the coordinator must not delete it.
      resources.track({
        kind: 'k',
        id: '1',
        owner,
        cleanup: () => {
          deleted = true;
        },
      });
      const summary = await resources.cleanupAll();

      expect(deleted, `a foreign ${label} must never be deleted`).toBe(false);
      expect(summary.failures[0]?.category).toBe('not-owned');
      expect(summary.failures[0]?.message).toContain('belongs to');
    }
  });

  test('the resource keeps the logical slot it was created in', async () => {
    const resources = new CleanupCoordinator({
      ledger: new ResourceLedger({ owner: { ...OWNER, slot: 2 } }),
    });
    const record = resources.track({ kind: 'k', id: '1', cleanup: () => undefined });
    expect(record.slot).toBe(2);
    await resources.cleanupAll();
    expect(resources.ledger.getBySlot(2)).toHaveLength(1);
  });
});

test.describe('cleanup: credential safety @framework', () => {
  const SECRET = 'hunter2-not-a-real-password';

  test('a secret in a cleanup error never reaches the summary or the journal', async () => {
    const { file, cleanup } = tempJournal();
    try {
      const ledger = new ResourceLedger({ owner: OWNER, journal: new FileResourceJournal(file) });
      const resources = new CleanupCoordinator({ ledger });
      resources.track({
        kind: 'k',
        id: '1',
        describe: `created with password=${SECRET}`,
        cleanup: () => {
          throw new Error(`delete failed for password=${SECRET}`);
        },
      });
      const summary = await resources.cleanupAll();

      expect(JSON.stringify(summary)).not.toContain(SECRET);
      expect(readFileSync(file, 'utf8')).not.toContain(SECRET);
    } finally {
      cleanup();
    }
  });
});
