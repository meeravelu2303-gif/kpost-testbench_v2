import { BugzillaClient } from '../../../src/bug-tracker/bugzilla/bugzilla-client';
import { buildDescription } from '../../../src/bug-tracker/ticket/bug-builder';
import {
  mergeCandidates,
  type BugCandidate,
} from '../../../src/bug-tracker/findings/bug-candidate';
import { parseAffectedEndpoints } from '../../../src/bug-tracker/status/verify-resolve';
import { runFiling, type FilingInput } from '../../../src/bug-tracker/filing/filing-run';
import { readBugzillaConfig } from '../../../src/config/bugzilla.config';
import { createLogger } from '../../../src/utils/logger';
import type {
  ValidationReport,
  ValidationResult,
} from '../../../src/validation-engine/validation-result';
import { expect, test } from '@fixtures';

/**
 * The bench follows the BUGZILLA-UI tracker's workflow (ops/bugzilla/setup-*.pl, rename-status.pl):
 * RESOLVED = "ready for re-test", CLOSED = "re-test passed" (was VERIFIED), and PENDING_APPROVAL /
 * AWAITING_REQUIREMENT / IN_REVIEW wait on a person. The bench is the re-test: a passing check
 * closes a bug as CLOSED, but never moves one that waits on a person.
 */

const log = createLogger('test');
const config = {
  ...readBugzillaConfig(),
  enabled: true,
  dryRun: false,
  autoResolve: true,
  resolveOnly: false,
  url: 'http://bugzilla.invalid/rest',
  apiKey: 'test-key',
  tagPrefix: 'KP',
};

const passed = (endpoint: string): ValidationResult =>
  ({
    validatorName: 'response.status-code',
    endpoint,
    endpointId: endpoint,
    status: 'PASSED',
    message: 'ok',
  }) as unknown as ValidationResult;

const input = (results: ValidationResult[]): FilingInput => ({
  version: 1,
  checkedAt: '2026-10-27T10:00:00.000Z',
  product: 'kpost-api',
  environment: 'production',
  testRunId: 'run-test',
  build: 'local',
  runStatus: 'passed',
  dryRun: false,
  validity: { valid: true, reason: '' },
  candidates: [],
  validationReports: [{ suite: 'kpost-api', results } as unknown as ValidationReport],
  uiRecords: [],
  uiEnvironmentalOnly: [],
});

interface Bug {
  id: number;
  summary: string;
  status: string;
  resolution: string;
  is_open: boolean;
}
const bug = (id: number, endpoint: string, status: string, resolution = ''): Bug => ({
  id,
  summary: `[KP-${String(id).padStart(6, '0')}] ${endpoint}: expected 400, got 500`,
  status,
  resolution,
  is_open: !resolution,
});

/** A fake Bugzilla: open bugs, the RESOLVED/FIXED queue, and a record of every write. */
function stub(open: Bug[], awaitingRetest: Bug[], comments: Record<number, string[]> = {}) {
  const writes: { method: string; path: string; body: Record<string, unknown> }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = ((url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    const path = u.replace(config.url, '').split('?')[0]!;
    const thread = /^\/bug\/(\d+)\/comment$/.exec(path);
    let body: unknown = {};
    if (method === 'GET' && u.includes('resolution=---')) body = { bugs: open };
    else if (method === 'GET' && u.includes('status=RESOLVED')) body = { bugs: awaitingRetest };
    else if (method === 'GET' && thread) {
      const id = Number(thread[1]);
      body = { bugs: { [id]: { comments: (comments[id] ?? []).map((text) => ({ text })) } } };
    } else if (method !== 'GET') {
      const sent = typeof init?.body === 'string' ? init.body : '{}';
      writes.push({ method, path, body: JSON.parse(sent) as Record<string, unknown> });
    }
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  }) as typeof fetch;
  return { writes, restore: () => (globalThis.fetch = real) };
}

const failed = (endpoint: string): ValidationResult => ({
  ...passed(endpoint),
  status: 'FAILED',
  message: 'expected 400, got 500',
});

test.describe('the tracker workflow @framework', () => {
  test('an open bug that is still broken, not re-checked or hand-filed gets nothing at all', async () => {
    const { writes, restore } = stub(
      [
        bug(401, 'POST /v2/d', 'CONFIRMED'),
        bug(402, 'POST /v2/not-run', 'IN_PROGRESS'),
        { ...bug(403, 'POST /v2/d', 'REOPENED'), summary: '[KP-HANDFILED] POST /v2/d: by hand' },
      ],
      [],
    );
    try {
      const result = await runFiling(input([failed('POST /v2/d')]), config, log);
      // Owner, 2026-10-27: open and still broken → no comment, keep it as it is.
      expect(writes).toEqual([]);
      expect(result.resolved?.confirmedFailing).toBe(1);
      expect(result.resolved?.byHand?.map((b) => b.bugId)).toEqual([403]);
    } finally {
      restore();
    }
  });

  test('the "check now passes" note on a bug that waits on a person is posted only once', async () => {
    const { writes, restore } = stub([bug(501, 'POST /v2/e', 'PENDING_APPROVAL')], [], {
      501: ['Re-checked by the automated test bench on …\n\nResult: THE CHECK NOW PASSES. …'],
    });
    try {
      await runFiling(input([passed('POST /v2/e')]), config, log);
      expect(writes, 'already said on an earlier run').toEqual([]);
    } finally {
      restore();
    }
  });

  test('a passing open bug is closed as CLOSED: RESOLVED/FIXED with the note, then CLOSED', async () => {
    const { writes, restore } = stub([bug(101, 'POST /v2/a', 'IN_PROGRESS')], []);
    try {
      const result = await runFiling(input([passed('POST /v2/a')]), config, log);
      expect(writes.map((w) => [w.path, w.body.status, w.body.resolution])).toEqual([
        ['/bug/101', 'RESOLVED', 'FIXED'],
        ['/bug/101', 'CLOSED', undefined],
      ]);
      expect(String((writes[0]!.body.comment as { body: string }).body)).toContain(
        'Result: VERIFIED FIXED',
      );
      expect(writes[1]!.body.comment, 'RESOLVED → CLOSED needs no second note').toBeUndefined();
      expect(result.resolved?.resolved).toMatchObject([{ bugId: 101, from: 'IN_PROGRESS' }]);
    } finally {
      restore();
    }
  });

  test('a bug a developer marked RESOLVED/FIXED is re-tested: pass → CLOSED, not run → untouched', async () => {
    const { writes, restore } = stub(
      [],
      [
        bug(201, 'POST /v2/b', 'RESOLVED', 'FIXED'),
        bug(202, 'POST /v2/not-run', 'RESOLVED', 'FIXED'),
        {
          ...bug(203, 'POST /v2/b', 'RESOLVED', 'FIXED'),
          summary: '[KP-GROUPADMINEXIT] POST /v2/b: hand-filed',
        },
      ],
    );
    try {
      const result = await runFiling(input([passed('POST /v2/b')]), config, log);
      expect(writes.map((w) => [w.path, w.body.status])).toEqual([['/bug/201', 'CLOSED']]);
      expect(String((writes[0]!.body.comment as { body: string }).body)).toContain(
        're-test passed',
      );
      expect(result.resolved?.retested, "hand-filed bugs are a person's re-test").toBe(2);
    } finally {
      restore();
    }
  });

  test('a passing bug that waits on a person keeps its status and gets a note saying so', async () => {
    const { writes, restore } = stub(
      [
        bug(301, 'POST /v2/c', 'PENDING_APPROVAL'),
        bug(302, 'POST /v2/c', 'AWAITING_REQUIREMENT'),
        bug(303, 'POST /v2/c', 'IN_REVIEW'),
      ],
      [],
    );
    try {
      const result = await runFiling(input([passed('POST /v2/c')]), config, log);
      expect(
        writes.every((w) => w.body.status === undefined),
        'no status changes',
      ).toBe(true);
      expect(writes.map((w) => w.path)).toEqual([
        '/bug/301/comment',
        '/bug/302/comment',
        '/bug/303/comment',
      ]);
      expect(String(writes[2]!.body.comment)).toContain(
        'The bug is IN REVIEW (waiting for the team lead to review the fix)',
      );
      expect(result.resolved?.waitingOnPerson?.map((w) => w.status)).toEqual([
        'PENDING_APPROVAL',
        'AWAITING_REQUIREMENT',
        'IN_REVIEW',
      ]);
      expect(result.resolved?.resolved).toEqual([]);
    } finally {
      restore();
    }
  });

  test("a person's edit of the bug report ([report-revision]) is what the bench reads", async () => {
    const real = globalThis.fetch;
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            bugs: {
              '7': {
                comments: [
                  { text: 'Representative endpoint: POST /v2/old' },
                  { text: 'Re-checked by the automated test bench on …' },
                  {
                    text:
                      '[report-revision]\nThe bug report was edited. This comment holds the full updated report.\n\n' +
                      'Representative endpoint: POST /v2/new',
                  },
                ],
              },
            },
          }),
          { status: 200 },
        ),
      );
    try {
      const client = new BugzillaClient(config, log);
      expect(await client.currentDescription(7)).toBe('Representative endpoint: POST /v2/new');
    } finally {
      globalThis.fetch = real;
    }
  });

  test('a platform-wide bug lists its endpoints the way the tracker\'s "Affected scope" card reads', () => {
    const sighting = (endpoint: string, module: string): BugCandidate =>
      ({
        id: 'KP-SYS001',
        source: 'api',
        title: 'Platform-wide — security headers missing',
        narrative: 'n',
        severity: 'MEDIUM',
        category: 'Security',
        classification: 'security.security-headers',
        component: 'kpost-webservice-application',
        endpoint,
        expected: 'e',
        actual: 'a',
        occurrences: 1,
        systemic: true,
        affectedEndpoints: [endpoint],
        affectedScope: [{ endpoint, module, count: 1 }],
        observedAt: '2026-10-27T10:00:00.000Z',
      }) as unknown as BugCandidate;
    const [merged] = mergeCandidates([
      sighting('POST /v2/a', 'Katchup Messaging V2'),
      sighting('POST /v2/a', 'Katchup Messaging V2'),
      sighting('GET /v2/b', 'User Profile V2'),
    ]);
    const description = buildDescription(merged!);

    // The tracker's own grouping regexes (BUGZILLA-UI backend/src/lib/grouping.ts).
    const header = /^\s*Affected endpoints\s*\((\d+)\)\s*,\s*observed by\s*(\d+)\s*test case/im;
    const row = /^\s*[-•]\s*([A-Z]+)\s+(\S+)\s*\(([^)]*)\)\s*x\s*(\d+)\s*$/gim;
    expect(header.exec(description)?.slice(1, 3)).toEqual(['2', '3']);
    expect([...description.matchAll(row)].map((m) => [m[2], m[3], m[4]])).toEqual([
      ['/v2/b', 'User Profile V2', '1'],
      ['/v2/a', 'Katchup Messaging V2', '2'],
    ]);
    // And the bench's own re-check still finds every endpoint in it.
    expect(parseAffectedEndpoints(description).sort()).toEqual(['GET /v2/b', 'POST /v2/a']);
  });
});
