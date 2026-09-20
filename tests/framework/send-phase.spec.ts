import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ApiClientPool } from '@api/client/api-client-pool';
import type { ApiRequest } from '@api/client/request-builder';
import { ApiResponseWrapper } from '@api/client/response-wrapper';
import { apiRegistry } from '@api/definitions/index';
import { readBugzillaConfig } from '@config/bugzilla.config';
import { suiteFor } from '@config/ownership.config';
import { EndpointExecutor } from '@engine/endpoint-executor';
import { flowFindingReports } from '@engine/flow-finding';
import { ProductionSafetyError } from '@engine/production-guard';
import { expect, test } from '@fixtures';
import { createLogger } from '@utils/logger';
import { candidatesFromReport } from '../../src/bug-tracker/bug-candidate';
import {
  CleanupCoordinator,
  FileResourceJournal,
  findOrphans,
  readJournalFile,
  ResourceLedger,
  type CleanupSummary,
  type ResourceOwner,
} from '../../src/test-data/index';

/**
 * Guards for Phase 3 §12 — the lifecycle PHASE on the send chokepoint, and the cleanup isolation it
 * makes possible.
 *
 * ## The defect these pin
 *
 * Cleanup deletes run with `allowLiveWrite: true`, and the chokepoint turned any 5xx from such a call
 * into a `FlowFinding` — which the `endpoints` fixture drains into a `ValidationReport` that travels
 * the whole Bugzilla pipeline. So a teardown delete that failed became a CRITICAL product defect on a
 * developer's queue, even though it ran after the assertions and says nothing about the behaviour
 * under test.
 *
 * ## What is asserted, and what is deliberately not
 *
 * Cleanup traffic is ISOLATED from the product-defect pipeline, and REMAINS VISIBLE on the cleanup
 * dimension. This is not suppression: every test below that proves a cleanup 5xx does not become a
 * candidate also proves it was recorded.
 *
 * Nothing about ACTION traffic changes — a lifecycle 5xx is still a flow finding, still a candidate.
 * `precondition` exists as a distinct, typed value but deliberately behaves like `action` here;
 * classifying a setup failure is Phase 3.3 work, not 3.1's.
 *
 * ## Why it is offline
 *
 * The executor takes its client pool by injection, so a stub pool returns a crafted response and no
 * request ever leaves the process. Everything else — the production guard, the QA-identifier guard,
 * the request builder — is the real code path, which is what makes the safety assertions meaningful.
 */

/** A destructive, non-mockFixture write: the shape a real cleanup delete has. */
const WRITE_ENDPOINT = 'katchup-delete-message';

const OWNER: ResourceOwner = {
  runId: 'run-send-phase-1',
  testCaseId: 'TC-API-kpost-api-katchup-delete-message-cleanup',
  slot: 0,
};

/** An executor whose every call resolves to `status`, without touching the network. */
function executorReturning(status: number, body = '{"status":"FAILURE"}'): EndpointExecutor {
  const client = {
    execute: (request: ApiRequest, label?: string): Promise<ApiResponseWrapper> =>
      Promise.resolve(
        new ApiResponseWrapper(request, status, {}, body, 7, undefined, label ?? 'primary'),
      ),
  };
  const pool = { get: () => Promise.resolve(client) } as unknown as ApiClientPool;
  return new EndpointExecutor(pool, apiRegistry, createLogger('send-phase-test'));
}

/**
 * Drives a write through the chokepoint. `auth: { header: undefined }` short-circuits the token
 * provider (no login), and an empty body names no identifier, so the QA guard passes.
 */
async function drive(
  executor: EndpointExecutor,
  options: { phase?: 'precondition' | 'action' | 'cleanup'; body?: Record<string, unknown> } = {},
): Promise<number> {
  const exchange = await executor.sendTo(
    WRITE_ENDPOINT,
    { body: options.body ?? {} },
    {
      label: 'feature:cleanup',
      auth: { header: undefined },
      allowLiveWrite: true,
      ...(options.phase ? { phase: options.phase } : {}),
    },
  );
  return exchange.status;
}

test.describe('send phase · the lifecycle boundary', () => {
  test.describe.configure({ mode: 'default' });

  test('an action request is the default, and behaves exactly as before @framework', async () => {
    const executor = executorReturning(500);
    expect(executor.phase, 'no scope open ⇒ action').toBe('action');

    await drive(executor);

    expect(
      executor.flowFindings,
      'a lifecycle 5xx is still a product-defect candidate',
    ).toHaveLength(1);
    expect(executor.cleanupFindings, 'and is not mistaken for cleanup').toEqual([]);
    expect(executor.flowFindings[0]?.status).toBe(500);
  });

  test('a precondition request is a distinct, typed phase @framework', async () => {
    const executor = executorReturning(500);
    let seen: string | undefined;
    await executor.withPhase('precondition', () => {
      seen = executor.phase;
      return Promise.resolve();
    });
    expect(seen, 'the scope is observable').toBe('precondition');
    expect(executor.phase, 'and restored afterwards').toBe('action');

    /*
     * Behaviour is deliberately unchanged for now: a 5xx during setup is still collected exactly as
     * an action's is. Deciding that a setup failure is a TEST_ISSUE rather than an app defect needs
     * the classifier (Phase 3.3); Step 3.1 only isolates CLEANUP.
     */
    await drive(executor, { phase: 'precondition' });
    expect(executor.flowFindings, 'precondition behaviour is untouched in 3.1').toHaveLength(1);
  });

  test('a cleanup request is distinguishable, by scope and by option @framework', async () => {
    const scoped = executorReturning(500);
    await scoped.withPhase('cleanup', () => drive(scoped));
    expect(scoped.cleanupFindings, 'ambient scope marks it').toHaveLength(1);

    const explicit = executorReturning(500);
    await drive(explicit, { phase: 'cleanup' });
    expect(explicit.cleanupFindings, 'an explicit option marks it too').toHaveLength(1);
  });

  test('a cleanup 5xx does NOT become a FlowFinding @framework', async () => {
    const executor = executorReturning(503);
    await executor.withPhase('cleanup', () => drive(executor));

    expect(executor.flowFindings, 'the product-defect pipeline never sees it').toEqual([]);
    expect(executor.cleanupFindings, 'it is recorded on the cleanup dimension').toHaveLength(1);
  });

  test('a cleanup 5xx REMAINS VISIBLE, with enough detail to act on @framework', async () => {
    const executor = executorReturning(500, '{"status":"FAILURE","message":"boom"}');
    await executor.withPhase('cleanup', () => drive(executor));

    const [finding] = executor.cleanupFindings;
    expect(finding, 'this is isolation, not suppression').toBeDefined();
    expect(finding?.endpointId).toBe(WRITE_ENDPOINT);
    expect(finding?.status).toBe(500);
    expect(finding?.label, 'the call site is identifiable').toBe('feature:cleanup');
    expect(finding?.correlationId, 'so the application log can be searched').toBeTruthy();
    expect(finding?.body, 'the response is quoted').toContain('boom');
  });

  test('no Bugzilla candidate can be built from a cleanup failure through this path @framework', async () => {
    const executor = executorReturning(500);
    await executor.withPhase('cleanup', () => drive(executor));

    // The exact pipeline the `endpoints` fixture runs: findings → reports → candidates.
    const reports = flowFindingReports(executor.flowFindings);
    expect(reports, 'no validation report is synthesised').toEqual([]);

    const candidates = reports.flatMap((report) =>
      candidatesFromReport(
        report,
        { baseURL: suiteFor(report.suite).baseUrl },
        readBugzillaConfig(),
      ),
    );
    expect(candidates, 'and therefore no bug candidate').toEqual([]);
  });

  test('an action 5xx still produces a filable candidate — unchanged @framework', async () => {
    const executor = executorReturning(500);
    await drive(executor);

    const reports = flowFindingReports(executor.flowFindings);
    expect(reports, 'the action path is untouched').toHaveLength(1);

    const candidates = reports.flatMap((report) =>
      candidatesFromReport(
        report,
        { baseURL: suiteFor(report.suite).baseUrl },
        readBugzillaConfig(),
      ),
    );
    expect(candidates.length, 'a real write crash still reaches the developer').toBeGreaterThan(0);
    expect(candidates[0]?.classification).toBe('flow.server-error');
  });

  test('an ambient cleanup scope overrides a per-call phase — the safe precedence @framework', async () => {
    const executor = executorReturning(500);
    // A closure that wrongly claims to be an action, while the framework knows it is cleaning up.
    await executor.withPhase('cleanup', () => drive(executor, { phase: 'action' }));

    expect(executor.flowFindings, 'the boundary the framework owns wins').toEqual([]);
    expect(executor.cleanupFindings).toHaveLength(1);
  });

  test('the scope is restored even when a cleanup operation throws @framework', async () => {
    const executor = executorReturning(500);
    await expect(
      executor.withPhase('cleanup', () => Promise.reject(new Error('delete exploded'))),
    ).rejects.toThrow('delete exploded');

    expect(executor.phase, 'a throwing teardown cannot strand the executor in cleanup').toBe(
      'action',
    );
  });

  test('a 4xx during cleanup is collected by neither — unchanged rule @framework', async () => {
    const executor = executorReturning(400);
    await executor.withPhase('cleanup', () => drive(executor));

    expect(executor.flowFindings, 'a 4xx might be our payload; it never files').toEqual([]);
    expect(executor.cleanupFindings, 'and it is not a cleanup server error either').toEqual([]);
  });

  test('the QA-identifier guard still refuses a foreign id during cleanup @framework', async () => {
    const executor = executorReturning(200);
    /*
     * The safety boundary must not widen because we are cleaning up. A stranger's message id is
     * refused in cleanup exactly as it is in an action.
     */
    await expect(
      executor.withPhase('cleanup', () => drive(executor, { body: { messageIds: [700001] } })),
    ).rejects.toThrow(ProductionSafetyError);
  });
});

test.describe('send phase · cleanup through the coordinator', () => {
  test.describe.configure({ mode: 'default' });

  /** A coordinator whose single resource is removed by a real `sendTo` through the executor. */
  async function runCleanup(
    executor: EndpointExecutor,
    cleanup: () => Promise<unknown>,
  ): Promise<CleanupSummary> {
    const ledger = new ResourceLedger({ owner: OWNER });
    const coordinator = new CleanupCoordinator({ ledger });
    coordinator.track({ kind: 'katchup-message', id: 811999, cleanup });
    // Exactly what the `resources` fixture does.
    return executor.withPhase('cleanup', () => coordinator.cleanupAll());
  }

  test('a delete that answers 500 is isolated, and the coordinator still reports @framework', async () => {
    const executor = executorReturning(500);
    const summary = await runCleanup(executor, () => drive(executor));

    expect(executor.flowFindings, 'no product defect from a teardown').toEqual([]);
    expect(executor.cleanupFindings, 'the 5xx is recorded').toHaveLength(1);
    expect(summary.registered, 'and the cleanup summary is produced as always').toBe(1);
    expect(summary.status, 'and a 500 is NOT a successful cleanup').toBe('FAILED');
  });

  test('a delete that THROWS is a cleanup failure — the dimensions stay independent @framework', async () => {
    const executor = executorReturning(500);
    const summary = await runCleanup(executor, () =>
      Promise.reject(new Error('delete rejected by the host')),
    );

    expect(summary.status, 'cleanup reports its own verdict').toBe('FAILED');
    expect(summary.failures[0]?.category).toBe('operation-threw');
    expect(executor.flowFindings, 'which is still not a product defect').toEqual([]);
  });

  test('cleanup never throws out of the boundary, so a test verdict is never replaced @framework', async () => {
    const executor = executorReturning(500);
    // `cleanupAll` swallowing the failure is what keeps PASS+FAILED and FAIL+FAILED both reachable.
    const summary = await runCleanup(executor, () => Promise.reject(new Error('boom')));
    expect(summary.failed).toBe(1);
  });
});

/**
 * A cleanup operation that RETURNS an HTTP status (which is what every cleanup closure in this repo
 * does) must have that status judged, not merely quoted.
 *
 * The bug these pin: a delete answering 500 was recorded as `CLEANED — deleted (500)`, so a resource
 * the host never removed was marked gone, `cleanupStatus` read SUCCESS, and — because `CLEANED` is
 * terminal while `CLEANUP_FAILED` is retryable — the recovery path was foreclosed too.
 *
 * These use the real `ResourceLedger`, `CleanupCoordinator` and `FileResourceJournal`, so the state
 * transitions asserted are the ones production writes, read back off disk.
 */
test.describe('cleanup result semantics · a returned status is judged', () => {
  test.describe.configure({ mode: 'default' });

  function tempJournal(): { file: string; remove: () => void } {
    const dir = mkdtempSync(path.join(tmpdir(), 'kpost-cleanup-semantics-'));
    return {
      file: path.join(dir, 'resources.jsonl'),
      remove: () => rmSync(dir, { recursive: true, force: true }),
    };
  }

  /** Runs one tracked resource's cleanup and returns the summary plus the journalled states. */
  async function cleanupWith(
    result: () => unknown,
  ): Promise<{ summary: CleanupSummary; states: string[]; cleanupResult?: string | null }> {
    const { file, remove } = tempJournal();
    try {
      const ledger = new ResourceLedger({ owner: OWNER, journal: new FileResourceJournal(file) });
      const coordinator = new CleanupCoordinator({ ledger });
      coordinator.track({ kind: 'katchup-message', id: 811999, cleanup: result });
      const summary = await coordinator.cleanupAll();
      const events = readJournalFile(file);
      return {
        summary,
        states: events.records.length
          ? [ledger.get({ kind: 'katchup-message', id: 811999 })?.state ?? '']
          : [],
        cleanupResult: ledger.get({ kind: 'katchup-message', id: 811999 })?.cleanupResult,
      };
    } finally {
      remove();
    }
  }

  test('200 and 204 confirm the deletion — CLEANED @framework', async () => {
    for (const status of [200, 204]) {
      const { summary, states, cleanupResult } = await cleanupWith(() => status);
      expect(states[0], `HTTP ${status} is a confirmed delete`).toBe('CLEANED');
      expect(summary.status).toBe('SUCCESS');
      expect(cleanupResult).toBe(`deleted (${status})`);
    }
  });

  test('a 4xx did not delete anything, so it is a cleanup failure @framework', async () => {
    const { summary, states, cleanupResult } = await cleanupWith(() => 404);

    // The host REJECTED the delete. Nothing was removed, so `CLEANED` would be a false claim — and
    // CLEANUP_FAILED keeps the resource retryable, which CLEANED (terminal) would not.
    expect(states[0]).toBe('CLEANUP_FAILED');
    expect(summary.status).toBe('FAILED');
    expect(summary.failures[0]?.category).toBe('operation-failed');
    expect(cleanupResult, 'and the reason distinguishes rejected from crashed').toContain(
      'HTTP 404',
    );
  });

  test('a 5xx walks REGISTERED → CLEANUP_PENDING → CLEANUP_FAILED @framework', async () => {
    const { file, remove } = tempJournal();
    try {
      const ledger = new ResourceLedger({ owner: OWNER, journal: new FileResourceJournal(file) });
      const coordinator = new CleanupCoordinator({ ledger });
      coordinator.track({ kind: 'katchup-message', id: 811999, cleanup: () => 500 });
      await coordinator.cleanupAll();

      const states = readFileSync(file, 'utf8')
        .trim()
        .split('\n')
        .map((line) => (JSON.parse(line) as { state: string }).state);
      expect(states, 'the journal records the whole walk').toEqual([
        'REGISTERED',
        'CLEANUP_PENDING',
        'CLEANUP_FAILED',
      ]);
      // The Phase 2.4 recovery view sees it as outstanding — evidence, not a deletion.
      expect(findOrphans(readJournalFile(file).records).failed).toHaveLength(1);
    } finally {
      remove();
    }
  });

  test('a 5xx makes cleanupStatus FAILED and stays visible in the summary @framework', async () => {
    const { summary } = await cleanupWith(() => 503);

    expect(summary.status).toBe('FAILED');
    expect(summary.failed).toBe(1);
    expect(summary.cleaned, 'it is not counted as cleaned').toBe(0);
    const [failure] = summary.failures;
    expect(failure?.category).toBe('operation-failed');
    expect(failure?.kind).toBe('katchup-message');
    expect(failure?.id).toBe('811999');
    expect(failure?.message, 'the reason names the status').toContain('HTTP 503');
  });

  test('a transport failure (status 0) is a cleanup failure, not a deletion @framework', async () => {
    const { summary, states } = await cleanupWith(() => 0);
    expect(states[0]).toBe('CLEANUP_FAILED');
    expect(summary.failures[0]?.message).toContain('no HTTP response');
  });

  test('a number that is not an HTTP status is not judged as one @framework', async () => {
    // `cleanup: () => list.push(id)` returns the array LENGTH. It must not read as a failure.
    const { summary, states } = await cleanupWith(() => [1, 2, 3].push(4));
    expect(states[0], 'an accidental number keeps the throw-on-failure contract').toBe('CLEANED');
    expect(summary.status).toBe('SUCCESS');
  });

  test('returning nothing keeps the throw-on-failure contract @framework', async () => {
    const { summary, states } = await cleanupWith(() => undefined);
    expect(states[0]).toBe('CLEANED');
    expect(summary.status).toBe('SUCCESS');
  });

  test('an object carrying a status is judged by it @framework', async () => {
    const { states } = await cleanupWith(() => ({ status: 500 }));
    expect(states[0]).toBe('CLEANUP_FAILED');
  });

  test('a 5xx cleanup does not stop the rest, and LIFO is unchanged @framework', async () => {
    const order: string[] = [];
    const ledger = new ResourceLedger({ owner: OWNER });
    const coordinator = new CleanupCoordinator({ ledger });
    coordinator.track({
      kind: 'k',
      id: 'A',
      cleanup: () => {
        order.push('A');
      },
    });
    // The middle one fails with a server error.
    coordinator.track({
      kind: 'k',
      id: 'B',
      cleanup: () => {
        order.push('B');
        return 500;
      },
    });
    coordinator.track({
      kind: 'k',
      id: 'C',
      cleanup: () => {
        order.push('C');
      },
    });

    const summary = await coordinator.cleanupAll();

    expect(order, 'newest first, and a failure in the middle stops nothing').toEqual([
      'C',
      'B',
      'A',
    ]);
    expect(summary.cleaned).toBe(2);
    expect(summary.failed).toBe(1);
    expect(ledger.get({ kind: 'k', id: 'B' })?.state).toBe('CLEANUP_FAILED');
    expect(ledger.get({ kind: 'k', id: 'A' })?.state).toBe('CLEANED');
  });

  test('a status-failed cleanup may be RETRIED through the existing state machine @framework', async () => {
    const ledger = new ResourceLedger({ owner: OWNER });
    const coordinator = new CleanupCoordinator({ ledger });
    let attempt = 0;
    const record = coordinator.track({
      kind: 'k',
      id: 'retry-1',
      cleanup: () => {
        attempt += 1;
        return attempt === 1 ? 500 : 200;
      },
    });

    await coordinator.cleanupAll();
    expect(ledger.get(record)?.state, 'first attempt failed').toBe('CLEANUP_FAILED');

    // CLEANUP_FAILED → CLEANUP_PENDING → CLEANED is the transition the ledger already allows.
    await coordinator.cleanupOne(record);
    expect(ledger.get(record)?.state, 'and the retry succeeds').toBe('CLEANED');
    expect(attempt).toBe(2);
  });

  test('a CLEANED resource is never deleted twice @framework', async () => {
    const ledger = new ResourceLedger({ owner: OWNER });
    const coordinator = new CleanupCoordinator({ ledger });
    let calls = 0;
    const record = coordinator.track({
      kind: 'k',
      id: 'once',
      cleanup: () => {
        calls += 1;
        return 200;
      },
    });

    await coordinator.cleanupAll();
    await coordinator.cleanupOne(record);

    expect(calls, 'CLEANED is terminal, so no second delete is issued').toBe(1);
  });
});
