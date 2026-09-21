import { ROOT_DIR } from '@config/constants';
import { expect, test } from '@fixtures';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { BugzillaClient } from '../../src/bug-tracker/bugzilla-client';
import { readBugzillaConfig } from '../../src/config/bugzilla.config';
import {
  alreadyEnriched,
  enrichmentSecrets,
  parseFilingManifest,
  renderEnrichment,
  type EnrichableDefect,
} from '../../src/bug-tracker/curated/index';

/**
 * `npm run bugs:enrich:kpost` — adds the full evidence to bugs that are ALREADY filed.
 *
 * ## Why a comment rather than a better description
 *
 * Bugzilla's REST API cannot edit comment 0, so a description is fixed at creation. The eight
 * tickets were created with a summary-level description; this adds the developer-ready evidence as a
 * comment on each, in the structure the existing high-quality KPost tickets use.
 *
 * ## What it will not do
 *
 * Create a bug, resolve one, close one, reopen one, or change any field. The only Bugzilla operation
 * it can perform is `addComment`, and only on a bug id that the manifest records — which in turn was
 * read from the filing result, never guessed.
 *
 * Reruns are safe: each comment carries an `[evidence:<canonical id>]` marker, and a bug that
 * already has its marker is skipped rather than commented on twice.
 */

const MANIFEST = path.join(ROOT_DIR, 'reports', 'bugs', 'KPOST-API-FILING-MANIFEST.json');
const PREVIEW = path.join(ROOT_DIR, 'reports', 'bugs', 'KPOST-API-ENRICHMENT-PREVIEW.md');

/** Armed only when the command says so AND the kill-switch is absent. */
function armed(): boolean {
  if (process.env.CURATED_FILING_FORCE_DRY_RUN === 'true') return false;
  return process.env.CURATED_ENRICH_ARMED === 'true';
}

interface EnrichRun {
  rows: string[];
  previews: string[];
  added: number;
  skipped: number;
  failed: number;
}

/**
 * Posts (or previews) the evidence comment for every defect.
 *
 * Hoisted out of the test body so the flow — dry-run, already-enriched, failure — is expressed
 * once here rather than as branching inside an assertion block.
 */
async function enrichAll(
  defects: readonly EnrichableDefect[],
  dryRun: boolean,
  config: ReturnType<typeof readBugzillaConfig>,
): Promise<EnrichRun> {
  const client = config.enabled ? new BugzillaClient(config, console as never) : undefined;
  const run: EnrichRun = { rows: [], previews: [], added: 0, skipped: 0, failed: 0 };

  for (const defect of defects) {
    const id = defect.bugzillaId ?? 0;
    const text = renderEnrichment(defect);
    const row = (action: string, note: string): void => {
      run.rows.push(`| ${String(id)} | \`${defect.canonicalDefectId}\` | ${action} | ${note} |`);
    };
    run.previews.push(
      `\n\n## Bug ${String(id)} — ${defect.canonicalDefectId}\n\n\`\`\`text\n${text}\n\`\`\``,
    );

    if (dryRun || !client) {
      row('WOULD-ADD', `${String(text.length)} chars`);
      run.added += 1;
      continue;
    }

    const existing = await client.firstComment(id);
    if (alreadyEnriched(defect, existing === undefined ? [] : [existing])) {
      row('SKIPPED', 'already enriched');
      run.skipped += 1;
      continue;
    }

    const result = await client.addComment(id, text);
    if ('error' in result) {
      row('FAILED', result.error);
      run.failed += 1;
      continue;
    }
    row('ADDED', `${String(text.length)} chars`);
    run.added += 1;
  }
  return run;
}

test.describe('curated KPost API bug enrichment', { tag: '@curated-filing' }, () => {
  test.describe.configure({ mode: 'default' });

  test('adds full evidence to the already-filed bugs @filing', async () => {
    const manifest = parseFilingManifest(
      JSON.parse(readFileSync(MANIFEST, 'utf8')),
      'KPOST-API-FILING-MANIFEST.json',
    );
    const defects = manifest.defects as EnrichableDefect[];
    const dryRun = !armed();
    const config = readBugzillaConfig();

    // A missing id means the defect was never filed — enriching it would be commenting on a guess.
    const unfiled = defects
      .filter((d) => d.bugzillaId === undefined)
      .map((d) => d.canonicalDefectId);
    expect(unfiled, 'every defect must carry the Bugzilla id recorded at filing time').toEqual([]);

    const leaks = defects.flatMap((d) =>
      enrichmentSecrets(d).map((s) => `${d.canonicalDefectId}: ${s}`),
    );
    expect(leaks, 'a comment is permanent — nothing containing a secret may be posted').toEqual([]);

    const { rows, previews, added, skipped, failed } = await enrichAll(defects, dryRun, config);

    writeFileSync(
      PREVIEW,
      [
        '# KPost API bug enrichment — ' + (dryRun ? 'PREVIEW (nothing posted)' : 'APPLIED'),
        '',
        'Bugzilla cannot edit a description after creation, so the full evidence is added as a',
        'comment on each already-filed bug. Reruns are safe: a bug that already carries its',
        '`[evidence:<canonical id>]` marker is skipped.',
        '',
        '| Bug | Canonical defect | Action | Note |',
        '| --- | ---------------- | ------ | ---- |',
        ...rows,
        '',
        `Added/would-add: ${String(added)} · skipped: ${String(skipped)} · failed: ${String(failed)}`,
        '',
        '---',
        '',
        '# The exact comment text for each bug',
        ...previews,
        '',
      ].join('\n'),
    );

    console.log(
      `enrichment · ${dryRun ? 'DRY RUN' : 'LIVE'} · would-add/added ${String(added)} · skipped ${String(skipped)} · failed ${String(failed)}`,
    );
    expect(failed, 'a comment that could not be posted must be investigated').toBe(0);
  });
});
