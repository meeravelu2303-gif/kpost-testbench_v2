import { ROOT_DIR } from '@config/constants';
import { expect, test } from '@fixtures';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { BugzillaClient } from '../../src/bug-tracker/bugzilla-client';
import { readBugzillaConfig } from '../../src/config/bugzilla.config';
import {
  fileCuratedDefects,
  parseFilingManifest,
  summariseCuratedFiling,
  type CuratedBugzillaClient,
} from '../../src/bug-tracker/curated/index';

/**
 * The curated filing entry point — `npm run bugs:file:kpost`.
 *
 * This is the ONLY path that may create a KPost API ticket from reviewed evidence. Its population is
 * `reports/bugs/KPOST-API-FILING-MANIFEST.json` and nothing else: it never looks at `REPORT.json`,
 * the validation reports, `observations.jsonl` or the validity gate, so an evidence-incomplete
 * candidate has no route to Bugzilla here however it is classified elsewhere.
 *
 * It is a Playwright test rather than a standalone script because this repository has no TypeScript
 * runner — Playwright is how TS executes here, and `scripts/file-curated-bugs.cjs` is the thin
 * wrapper that sets the environment and execs it, exactly as `bench.cjs` does for the suites.
 *
 * ## Safety
 *
 * Dry-run is the default and has to be disarmed deliberately. `BUGZILLA_AUTO_RESOLVE` is forced off
 * by the wrapper, and more importantly the filer has no resolve, close or reopen capability at all,
 * which a framework guard asserts against its source. So the worst this can do is create a ticket
 * the manifest approved.
 */

const MANIFEST = path.join(ROOT_DIR, 'reports', 'bugs', 'KPOST-API-FILING-MANIFEST.json');
const RESULT = path.join(ROOT_DIR, 'reports', 'bugs', 'KPOST-API-FILING-RESULT.md');

/**
 * Whether this invocation may write to Bugzilla.
 *
 * Armed only when the command says so AND the kill-switch is absent. Two independent conditions,
 * because a single flag is one typo away from a live filing run.
 */
function armed(): boolean {
  if (process.env.CURATED_FILING_FORCE_DRY_RUN === 'true') return false;
  return process.env.BUGZILLA_DRY_RUN === 'false' && process.env.CURATED_FILING_ARMED === 'true';
}

/**
 * The live client when Bugzilla is configured, a stub when it is not.
 *
 * Module scope so the test body carries no branching. The stub answers "no existing bug" and "the
 * assignee exists", which makes an unconfigured dry run still exercise the real gates, the real
 * dedup branch and the real rendering instead of skipping.
 */
function clientFor(config: ReturnType<typeof readBugzillaConfig>): CuratedBugzillaClient {
  if (config.enabled) {
    // The real client satisfies the narrow interface structurally — no cast needed.
    return new BugzillaClient(config, console as never);
  }
  return {
    findByTag: () => Promise.resolve({ bugs: [] }),
    userExists: () => Promise.resolve(true),
    createBug: () => Promise.resolve({ error: 'Bugzilla not configured' }),
    addComment: () => Promise.resolve({ error: 'Bugzilla not configured' }),
  };
}

test.describe('curated KPost API filing', { tag: '@curated-filing' }, () => {
  test.describe.configure({ mode: 'default' });

  test('files only the manifest-approved canonical defects @filing', async () => {
    const manifest = parseFilingManifest(
      JSON.parse(readFileSync(MANIFEST, 'utf8')),
      'KPOST-API-FILING-MANIFEST.json',
    );
    const dryRun = !armed();

    /*
     * A stub stands in when Bugzilla is not configured, so the dry run still exercises the real
     * gates, the real dedup branch and the real rendering rather than skipping. It answers "no
     * existing bug" and "the assignee exists", which is the shape that produces the most honest
     * preview — every approved record shows as it WOULD be created.
     */
    const bugzillaConfig = readBugzillaConfig();
    const client = clientFor(bugzillaConfig);

    const result = await fileCuratedDefects(manifest, client, { dryRun });

    const header = [
      '# KPost API curated filing — result',
      '',
      `**${dryRun ? 'DRY RUN — nothing was sent to Bugzilla.' : 'LIVE FILING.'}**`,
      `Manifest: ${manifest.defects.length} record(s) loaded · ${String(result.approved)} approved.`,
      `Bugzilla configured: ${String(bugzillaConfig.enabled)}`,
      '',
      '| Canonical ID | Operation | Bugzilla ID | Component | Assignee | Note |',
      '| ------------ | --------- | ----------- | --------- | -------- | ---- |',
      ...result.entries.map(
        (e) =>
          `| \`${e.canonicalDefectId}\` | **${e.operation}** | ${e.bugzillaId ? String(e.bugzillaId) : '—'} | ` +
          `${e.component} | ${e.assignee} | ${e.reason ?? ''} |`,
      ),
      '',
      '| Outcome | Count |',
      '| ------- | ----: |',
      ...Object.entries(result.counts).map(([k, v]) => `| ${k} | ${String(v)} |`),
      '',
      result.gatesPassed
        ? 'All pre-flight gates passed.'
        : `**REFUSED — no record was filed.**\n\n${result.gateFailures.map((f) => `- ${f}`).join('\n')}`,
      '',
    ].join('\n');
    writeFileSync(RESULT, header);

    console.log(
      [
        `curated filing · ${dryRun ? 'DRY RUN' : 'LIVE'} · loaded ${String(result.loaded)} · approved ${String(result.approved)}`,
        ...summariseCuratedFiling(result),
        `counts: ${JSON.stringify(result.counts)}`,
      ].join('\n'),
    );

    expect(result.gatesPassed, `pre-flight gates: ${result.gateFailures.join(' | ')}`).toBe(true);
    expect(
      result.counts.FAILED,
      'a record that could not be filed must be investigated, not ignored',
    ).toBe(0);
    expect(result.loaded, 'every manifest record must be accounted for in the result').toBe(
      result.entries.length,
    );
  });
});
