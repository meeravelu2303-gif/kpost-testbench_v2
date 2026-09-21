import { ROOT_DIR } from '@config/constants';
import { expect, test } from '@fixtures';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildBugFields } from '../../src/bug-tracker/bug-builder';
import {
  checkFilingGates,
  contextOf,
  fileCuratedDefects,
  manifestToCandidate,
  parseFilingManifest,
  type BugRef,
  type CuratedBugzillaClient,
  type FilingManifest,
  type ManifestDefect,
} from '../../src/bug-tracker/curated/index';

/**
 * Guards for the curated Bugzilla filer.
 *
 * The property under test throughout: **the manifest is the only route to Bugzilla.** A finding can
 * be reproducible, application-attributed and severe, and still have no path to a ticket unless a
 * person put it in the manifest with status `READY_FOR_BUGZILLA`.
 *
 * Every test uses a stub client. Nothing here reaches a live Bugzilla, by construction — the filer
 * takes the client as a parameter precisely so it can be substituted.
 */

const MANIFEST = path.join(ROOT_DIR, 'reports', 'bugs', 'KPOST-API-FILING-MANIFEST.json');

const defect = (over: Partial<ManifestDefect> = {}): ManifestDefect => ({
  canonicalDefectId: 'CD-TEST-001',
  summary: 'an endpoint returns an unhandled 500 for a null field',
  endpoint: '/v2/test/endpoint',
  method: 'POST',
  module: 'test',
  product: 'KPost API',
  component: 'Authentication V2',
  assignee: 'jagan@kpost.in',
  ownerName: 'Jaganathan Murthy',
  assignmentSource: 'ownership.config.ts',
  environment: 'testingapi',
  expected: 'a null must not crash the server',
  actual: 'HTTP 500',
  reproduction: ['authenticate', 'POST with field: null'],
  independentConfirmation: 'control vs mutant on the same endpoint',
  evidenceRefs: ['tb-1234'],
  benchTags: ['KP-TEST01'],
  sourceRun: 'run-test',
  /*
   * Required to FILE (not merely to parse): the classification and category below are what the
   * ticket's `Classification:` line and `[cat:…]` whiteboard are built from, and the severity band
   * is what stops Bugzilla defaulting the record to `enhancement`.
   */
  benchSeverity: 'HIGH (bench validator class)',
  enrichment: {
    classification: 'request.null-value',
    category: 'Functional',
    whatThisMeans: 'A null in one field crashes the endpoint instead of being rejected.',
    whyItMatters:
      'An unhandled crash on a client input is a robustness defect, not a validation one.',
    developerGuidance:
      'The evidence shows a crash rather than a rejection; the cause is not visible.',
    occurrences: 'Observed once in the targeted confirmation.',
    curl: "curl -i -X POST 'https://example.test/v2/test/endpoint' -d '{\"field\": null}'",
    affectedScope: 'One endpoint.',
  },
  filingStatus: 'READY_FOR_BUGZILLA',
  ...over,
});

/** The Bugzilla payload a record would actually produce. */
const payloadFor = (over: Partial<ManifestDefect> = {}): ReturnType<typeof buildBugFields> => {
  const manifest = manifestOf(defect(over));
  const candidate = manifestToCandidate(manifest.defects[0] as ManifestDefect, contextOf(manifest));
  return buildBugFields(candidate, { version: candidate.version, assignee: candidate.assignee });
};

const manifestOf = (...defects: ManifestDefect[]): FilingManifest => ({
  meta: { product: 'KPost API' },
  defects,
});

interface StubCalls {
  created: Record<string, unknown>[];
  comments: number[];
  attached: string[];
}

function stub(over: Partial<CuratedBugzillaClient> = {}): {
  client: CuratedBugzillaClient;
  calls: StubCalls;
} {
  const calls: StubCalls = { created: [], comments: [], attached: [] };
  const client: CuratedBugzillaClient = {
    findByTag: () => Promise.resolve({ bugs: [] }),
    userExists: () => Promise.resolve(true),
    createBug: (fields) => {
      calls.created.push(fields);
      return Promise.resolve({ id: 1000 + calls.created.length });
    },
    addComment: (id) => {
      calls.comments.push(id);
      return Promise.resolve({ ok: true });
    },
    attach: (_id, attachment) => {
      calls.attached.push(attachment.fileName);
      return Promise.resolve();
    },
    ...over,
  };
  return { client, calls };
}

/**
 * A bug in the shape the REAL client returns — `is_open`, optional `resolution`, optional
 * `product`. An earlier stub invented a `status` field, and because only the stub was tested the
 * mismatch survived until the first live dry run threw. A stub that does not match its real
 * counterpart tests nothing.
 */
const bug = (over: Partial<BugRef> = {}): BugRef => ({
  id: 500,
  summary: '[KP-TEST01] an endpoint returns an unhandled 500',
  product: 'KPost API',
  is_open: true,
  ...over,
});

test.describe('curated filer: the manifest is the only allowlist @framework', () => {
  test.describe.configure({ mode: 'default' });

  test('an approved record is filed', async () => {
    const { client, calls } = stub();
    const result = await fileCuratedDefects(manifestOf(defect()), client, { dryRun: false });
    expect(result.counts.CREATED).toBe(1);
    expect(calls.created).toHaveLength(1);
  });

  test('a candidate absent from the manifest has no route to Bugzilla', async () => {
    /*
     * The central property. The filer takes a manifest and nothing else — no run, no report, no
     * observation stream — so "a candidate the manifest does not contain" is not a case the code
     * has to reject; it is a case it cannot see. An empty manifest files nothing.
     */
    const { client, calls } = stub();
    const result = await fileCuratedDefects(
      { meta: { product: 'KPost API' }, defects: [] },
      client,
      {
        dryRun: false,
      },
    );
    expect(result.entries).toEqual([]);
    expect(calls.created, 'nothing outside the manifest can be filed').toEqual([]);
  });

  test('a record that is not READY_FOR_BUGZILLA is refused by the schema itself', () => {
    /*
     * Refused at parse time rather than at filing time, so a non-approved record never becomes a
     * `ManifestDefect` in the first place. `POTENTIAL_DEFECT`, `CONTRACT_UNPROVEN`,
     * `INFRASTRUCTURE_ORIGIN`, `BENCH_ARTEFACT` and anything not yet invented all fail the same way.
     */
    for (const status of [
      'POTENTIAL_DEFECT',
      'CONTRACT_UNPROVEN',
      'INFRASTRUCTURE_ORIGIN',
      'BENCH_ARTEFACT',
      'NOT_A_DEFECT',
      'EVIDENCE_INCOMPLETE',
    ]) {
      expect(
        () =>
          parseFilingManifest(
            { meta: { product: 'KPost API' }, defects: [{ ...defect(), filingStatus: status }] },
            'test',
          ),
        `status ${status} must not parse as fileable`,
      ).toThrow();
    }
  });

  test('a record without a canonical defect id cannot be parsed or filed', () => {
    const withoutId = { ...defect(), canonicalDefectId: '' };
    expect(() =>
      parseFilingManifest({ meta: { product: 'KPost API' }, defects: [withoutId] }, 'test'),
    ).toThrow();
    // And if one reached the gates anyway, the gates refuse it.
    expect(checkFilingGates(manifestOf(withoutId)).join(' ')).toContain('no canonical defect id');
  });

  test('two records may not share a canonical defect id', () => {
    const failures = checkFilingGates(manifestOf(defect(), defect()));
    expect(failures.join(' ')).toContain('duplicate canonical defect ids');
  });
});

test.describe('curated filer: it cannot resolve, close or reopen @framework', () => {
  test.describe.configure({ mode: 'default' });

  test('the source contains no resolve, close or reopen capability', () => {
    /*
     * The strongest form of "auto-resolution is disabled": the capability is absent. A flag can be
     * flipped and an environment can be misconfigured, but code that does not exist cannot run.
     */
    const source = readFileSync(
      path.join(ROOT_DIR, 'src', 'bug-tracker', 'curated', 'curated-filer.ts'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '');
    for (const forbidden of ['resolveFixed', 'resolveInvalid', 'reopen(', 'appendWhiteboard']) {
      expect(source, `the curated filer must not be able to call ${forbidden}`).not.toContain(
        forbidden,
      );
    }
  });

  test('the client interface it accepts offers no resolve or reopen method', () => {
    // Even a caller that WANTED to resolve could not hand it a client that does.
    const source = readFileSync(
      path.join(ROOT_DIR, 'src', 'bug-tracker', 'curated', 'curated-filer.ts'),
      'utf8',
    );
    const iface = source.slice(
      source.indexOf('export interface CuratedBugzillaClient'),
      source.indexOf('export interface BugRef'),
    );
    expect(iface).toContain('createBug');
    expect(iface).not.toMatch(/resolve|reopen|close/i);
  });

  test('no filing outcome can be a resolution or a closure', async () => {
    const { client } = stub();
    const result = await fileCuratedDefects(manifestOf(defect()), client, { dryRun: false });
    for (const entry of result.entries) {
      expect(['CREATED', 'EXISTING', 'SKIPPED', 'FAILED']).toContain(entry.operation);
    }
  });
});

test.describe('curated filer: deduplication and human judgements @framework', () => {
  test.describe.configure({ mode: 'default' });

  test('an existing OPEN bug deduplicates instead of creating a second ticket', async () => {
    const { client, calls } = stub({ findByTag: () => Promise.resolve({ bugs: [bug()] }) });
    const result = await fileCuratedDefects(manifestOf(defect()), client, { dryRun: false });
    expect(result.counts.EXISTING).toBe(1);
    expect(result.counts.CREATED).toBe(0);
    expect(calls.created, 'a rerun must not duplicate a ticket it already filed').toEqual([]);
    expect(result.entries[0]?.bugzillaId).toBe(500);
  });

  test('a human INVALID / WONTFIX / WORKSFORME / DUPLICATE is never overridden', async () => {
    /*
     * The bench does not overrule a person who looked at the ticket and closed it. This is the
     * CD-BE-001 situation generalised: re-filing a human-judged fault is a decision for them, and
     * the filer records why it stood down rather than silently skipping.
     */
    for (const resolution of ['INVALID', 'WONTFIX', 'WORKSFORME', 'DUPLICATE']) {
      const { client, calls } = stub({
        findByTag: () => Promise.resolve({ bugs: [bug({ is_open: false, resolution })] }),
      });
      const result = await fileCuratedDefects(manifestOf(defect()), client, { dryRun: false });
      expect(result.counts.SKIPPED, `resolution ${resolution}`).toBe(1);
      expect(calls.created).toEqual([]);
      expect(result.entries[0]?.reason).toContain(resolution);
    }
  });

  test('a bug resolved FIXED is never duplicated by a second ticket', async () => {
    /*
     * The case the dry run caught live: bugs 493/494/495 were resolved FIXED between two previews,
     * and the records flipped from EXISTING to CREATED. The broad filer would REOPEN; this path has
     * no reopen capability by design, so the only safe answer is to stand down and say why.
     */
    const { client, calls } = stub({
      findByTag: () =>
        Promise.resolve({ bugs: [bug({ id: 493, is_open: false, resolution: 'FIXED' })] }),
    });
    const result = await fileCuratedDefects(manifestOf(defect()), client, { dryRun: false });
    expect(calls.created, 'a tracked fault must not get a second ticket').toEqual([]);
    expect(result.counts.SKIPPED).toBe(1);
    expect(result.entries[0]?.reason).toContain('resolved FIXED');
    expect(result.entries[0]?.reason).toContain('cannot reopen');
  });

  test('an OPEN bug still wins over a resolved one under the same tag', async () => {
    // A tag can carry both an old resolved ticket and the current open one; the open one is the
    // ticket to comment on, and the resolved branch must not shadow it.
    const { client } = stub({
      findByTag: () =>
        Promise.resolve({
          bugs: [
            bug({ id: 475, is_open: false, resolution: 'FIXED' }),
            bug({ id: 495, is_open: true }),
          ],
        }),
    });
    const result = await fileCuratedDefects(manifestOf(defect()), client, { dryRun: false });
    expect(result.counts.EXISTING).toBe(1);
    expect(result.entries[0]?.bugzillaId).toBe(495);
  });

  test('a bug in a DIFFERENT product does not deduplicate this one', async () => {
    // The same tag can exist under KMail; filing would then silently go missing.
    const { client } = stub({
      findByTag: () => Promise.resolve({ bugs: [bug({ product: 'KMail API' })] }),
    });
    const result = await fileCuratedDefects(manifestOf(defect()), client, { dryRun: false });
    expect(result.counts.CREATED).toBe(1);
  });

  test('a failed dedup search refuses to file rather than risk a duplicate', async () => {
    const { client, calls } = stub({
      findByTag: () => Promise.resolve({ error: 'search timeout' }),
    });
    const result = await fileCuratedDefects(manifestOf(defect()), client, { dryRun: false });
    expect(result.counts.FAILED).toBe(1);
    expect(calls.created, 'unknown dedup state means do not file').toEqual([]);
  });
});

test.describe('curated filer: gates, dry-run and partial failure @framework', () => {
  test.describe.configure({ mode: 'default' });

  test('an unresolved component stops that record, and the whole run', () => {
    expect(checkFilingGates(manifestOf(defect({ component: '   ' }))).join(' ')).toContain(
      'component unresolved',
    );
  });

  test('an assignee that disagrees with the ownership configuration is refused', () => {
    /*
     * The manifest cites `ownership.config.ts` as its assignment source, so the two disagreeing
     * means one of them is stale — and a ticket routed off a stale record reaches the wrong
     * developer. CLAUDE.md §6 already applies this rule to the live Bugzilla component defaults;
     * this is the same principle one layer earlier.
     */
    expect(checkFilingGates(manifestOf(defect({ assignee: 'x@y.z' }))).join(' ')).toContain(
      'manifest says x@y.z, ownership.config.ts says jagan@kpost.in',
    );
    expect(checkFilingGates(manifestOf(defect())), 'the shipped owner agrees').toHaveLength(0);
  });

  test('a missing assignee account fails that record instead of filing it nowhere', async () => {
    const { client, calls } = stub({ userExists: () => Promise.resolve(false) });
    const result = await fileCuratedDefects(manifestOf(defect()), client, { dryRun: false });
    expect(result.counts.FAILED).toBe(1);
    expect(calls.created).toEqual([]);
  });

  test('a gate failure files NOTHING — not even the records that would have passed', async () => {
    /*
     * All-or-nothing on purpose. A half-filed release is harder to reason about than a refused one,
     * and the value of this path is that what reaches Bugzilla was reviewed as a set.
     */
    const { client, calls } = stub();
    const result = await fileCuratedDefects(
      manifestOf(defect(), defect({ canonicalDefectId: 'CD-TEST-002', evidenceRefs: [] })),
      client,
      { dryRun: false },
    );
    expect(result.gatesPassed).toBe(false);
    expect(result.entries).toEqual([]);
    expect(calls.created).toEqual([]);
  });

  test('a dry run creates no Bugzilla mutation at all', async () => {
    const { client, calls } = stub();
    const result = await fileCuratedDefects(manifestOf(defect()), client, { dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.counts.CREATED, 'the preview still shows what WOULD be created').toBe(1);
    expect(calls.created, 'but nothing was sent').toEqual([]);
    expect(calls.comments).toEqual([]);
  });

  test('a partial failure is represented honestly, and the rest still file', async () => {
    let call = 0;
    const { client } = stub({
      createBug: (fields) => {
        call += 1;
        return Promise.resolve(call === 2 ? { error: 'Bugzilla 503' } : { id: 900 + call, fields });
      },
    });
    const result = await fileCuratedDefects(
      manifestOf(
        defect({ canonicalDefectId: 'CD-1', benchTags: ['KP-A'] }),
        defect({ canonicalDefectId: 'CD-2', benchTags: ['KP-B'] }),
        defect({ canonicalDefectId: 'CD-3', benchTags: ['KP-C'] }),
      ),
      client,
      { dryRun: false },
    );
    expect(result.counts.CREATED, 'two succeeded').toBe(2);
    expect(result.counts.FAILED, 'and the failure is not hidden').toBe(1);
    expect(result.entries.find((e) => e.canonicalDefectId === 'CD-2')?.operation).toBe('FAILED');
    expect(result.entries).toHaveLength(3);
  });

  test('a secret in the generated description refuses the record', () => {
    /*
     * Checked on the RENDERED body, because that is what leaves the process. Refused rather than
     * redacted: a ticket is permanent and a redaction that fires silently is a bug nobody sees.
     */
    const leaky = defect({
      actual: 'HTTP 500 with Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123',
    });
    expect(checkFilingGates(manifestOf(leaky)).join(' ')).toContain('bearer token');
  });

  test('bench severity is never presented as a product severity', () => {
    /*
     * The band still reaches Bugzilla's severity field — that is what stopped these being filed as
     * `enhancement` — but the body says plainly that it is the bench's validator class and that
     * product triage belongs to the team.
     */
    const fields = payloadFor({ benchSeverity: 'CRITICAL (bench validator class)' });
    expect(fields.severity, 'the band must reach Bugzilla, not be defaulted').toBe('critical');
    expect(fields.description).toContain('bench validator class');
    expect(fields.description).toContain('is the team’s call, not the bench’s');
  });

  test('a confirmed scope travels into the ticket body', () => {
    // The AWS and kpostIdExist defects are confirmed for ONE field; a ticket that blurred that would
    // send a developer after behaviour the bench measured as working.
    const fields = payloadFor({
      confirmedScope: 'extension = null only; fileName = null is NOT confirmed',
    });
    expect(fields.description).toContain('Confirmed scope:');
    expect(fields.description).toContain('fileName = null is NOT confirmed');
    expect(fields.description).toContain('Nothing outside that scope is claimed here');
  });

  test('a record the adapter cannot map is refused, never defaulted', () => {
    /*
     * The exact failure that produced bugs 493–500: a value the payload did not carry became
     * Bugzilla's default. Now an unreadable severity band or category stops the record — and,
     * because the gate is all-or-nothing, the whole run.
     */
    expect(
      checkFilingGates(manifestOf(defect({ benchSeverity: 'severe-ish' }))).join(' '),
    ).toContain('names no severity band');
    const noCategory = defect();
    noCategory.enrichment = { ...noCategory.enrichment!, category: 'Vibes' };
    expect(checkFilingGates(manifestOf(noCategory)).join(' ')).toContain(
      'not a known defect category',
    );
    const noEnrichment = defect();
    delete noEnrichment.enrichment;
    expect(checkFilingGates(manifestOf(noEnrichment)).join(' ')).toContain('no enrichment block');
  });

  test('an evidence attachment is uploaded with every created ticket', async () => {
    const { client, calls } = stub();
    await fileCuratedDefects(manifestOf(defect()), client, { dryRun: false });
    expect(calls.attached, 'the unabridged evidence is what the description had to clamp').toEqual([
      'KP-TEST01-evidence.txt',
    ]);
  });
});

test.describe('curated filer: the real manifest @framework', () => {
  test.describe.configure({ mode: 'default' });

  test('the checked-in manifest parses and every record passes the gates', () => {
    const manifest = parseFilingManifest(
      JSON.parse(readFileSync(MANIFEST, 'utf8')) as unknown,
      'KPOST-API-FILING-MANIFEST.json',
    );
    expect(manifest.defects.length).toBeGreaterThan(0);
    expect(checkFilingGates(manifest), 'the shipped manifest must be fileable as-is').toEqual([]);
  });

  test('the manifest excludes every defect that must not be filed', () => {
    const manifest = parseFilingManifest(
      JSON.parse(readFileSync(MANIFEST, 'utf8')) as unknown,
      'KPOST-API-FILING-MANIFEST.json',
    );
    const ids = manifest.defects.map((d) => d.canonicalDefectId);
    // CD-BE-001's tags were human-judged; CD-BE-003/004 were never exercised on a run.
    for (const excluded of ['CD-BE-001', 'CD-BE-002', 'CD-BE-003', 'CD-BE-004', 'CD-BE-008']) {
      expect(ids, `${excluded} must not be in the filing set`).not.toContain(excluded);
    }
  });
});
