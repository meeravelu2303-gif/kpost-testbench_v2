import { readFileSync } from 'node:fs';
import { readBugzillaConfig } from '@config/bugzilla.config';
import { createLogger } from '@utils/logger';
import { test } from '@playwright/test';
import {
  buildBugFields,
  buildDescription,
  buildSummary,
} from '../../../src/bug-tracker/ticket/bug-builder';
import { BugzillaClient } from '../../../src/bug-tracker/bugzilla/bugzilla-client';
import { gatekeep } from '../../../src/bug-tracker/gates/gatekeeper';
import type { BugCandidate } from '../../../src/bug-tracker/findings/bug-candidate';

/**
 * The single supported way to file a bug by hand: it uses the engine's formatter and gatekeeper,
 * so a hand-filed ticket has the same layout and fingerprint tag as a generated one.
 *
 * ## Usage
 *
 *   npm run bug:preview -- --bug=path/to/finding.json     # render it, file nothing
 *   npm run bug:file    -- --bug=path/to/finding.json     # actually file it
 *
 * The JSON is a partial `BugCandidate`. The fields below are required; everything else has a
 * sensible default. See `src/bug-tracker/findings/bug-candidate.ts` for the full shape.
 *
 *   id              fingerprint tag, e.g. "KPV2-SIGNUPBLOCK" — dedup depends on it being stable
 *   classification  what kind of check found it, e.g. "flow.server-error"
 *   severity        BLOCKER | CRITICAL | MAJOR | NORMAL | MINOR
 *   product         e.g. "KPost API"
 *   component       must already exist in Bugzilla for that product
 *   endpoint        e.g. "POST /v2/signupLogin/signup/"
 *   narrative       what the defect is, in prose — wrapped to 78 columns on render
 *   expected        one line
 *   actual          one line
 *
 * Strongly encouraged:
 *
 *   repro           the steps, including the 3-pass gate result
 *   curl            runnable, with $KPOST_TOKEN in place of a real bearer token
 *   verificationSql the query that shows the discrepancy, for any DB-backed finding
 *   reproduction    { attempts, failures } — say whether it failed once or every time
 */

const REQUIRED = [
  'id',
  'classification',
  'severity',
  'product',
  'component',
  'narrative',
  'expected',
  'actual',
] as const;

// Accept Bugzilla's severity words too (blocker, major, normal) and map them to the internal scale,
// or the severity floor would silently reject them.
const SEVERITY_ALIASES: Record<string, string> = {
  blocker: 'CRITICAL',
  critical: 'CRITICAL',
  major: 'HIGH',
  high: 'HIGH',
  normal: 'MEDIUM',
  medium: 'MEDIUM',
  minor: 'LOW',
  low: 'LOW',
  trivial: 'INFO',
  info: 'INFO',
  enhancement: 'INFO',
};

function normaliseSeverity(value: unknown): string {
  const key = (typeof value === 'string' ? value : '').trim().toLowerCase();
  const mapped = SEVERITY_ALIASES[key];
  if (!mapped) {
    throw new Error(
      `severity "${String(value)}" is not recognised — use one of: ` +
        `blocker, critical, major, high, normal, medium, minor, low, info`,
    );
  }
  return mapped;
}

function loadCandidate(): BugCandidate {
  const arg = process.argv.find((a) => a.startsWith('--bug='));
  const file = arg ? arg.slice('--bug='.length) : process.env.MANUAL_BUG;
  if (!file) throw new Error('no finding given: pass --bug=<file.json> or set MANUAL_BUG');

  const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  const missing = REQUIRED.filter((k) => !raw[k]);
  if (missing.length) {
    throw new Error(
      `the finding is missing required field(s): ${missing.join(', ')}.\n` +
        'A ticket without these cannot be triaged — see the usage block in this file.',
    );
  }
  raw.severity = normaliseSeverity(raw.severity);

  // Defaults for the bookkeeping fields, so a finding need not restate the environment.
  return {
    source: 'api',
    suiteId: 'kpost-api',
    title: String(raw.id),
    category: 'Functional',
    // A person wrote this bug, so the tracker shows it as a manual test, not bench automation.
    filedBy: 'manual',
    version: 'unspecified',
    assignee: 'jagan@kpost.in',
    ownerName: 'Jaganathan Murthy',
    environment: process.env.TEST_ENV ?? 'test',
    baseURL: process.env.KPOST_API_BASE_URL ?? '',
    build: process.env.BUILD_ID ?? 'local',
    testRunId: `manual-${new Date().toISOString().slice(0, 10)}`,
    observedAt: new Date().toISOString(),
    occurrences: 1,
    evidence: {},
    ...raw,
  } as BugCandidate;
}

// eslint-disable-next-line playwright/expect-expect -- a filing tool, not a check: it skips unless a finding is supplied and its outcome is the Bugzilla write it logs.
test('file a hand-authored finding through the standard formatter', async () => {
  // Inert unless a finding is supplied (`npm run framework` also picks this spec up).
  const supplied =
    process.argv.some((a) => a.startsWith('--bug=')) || Boolean(process.env.MANUAL_BUG);
  test.skip(!supplied, 'no finding supplied — pass --bug=<file.json> (see the usage block above)');
  test.setTimeout(120_000);
  const bugzillaConfig = readBugzillaConfig();
  const log = createLogger('manual-bug');
  const candidate = loadCandidate();

  const fields = buildBugFields(candidate, {
    version: candidate.version,
    assignee: candidate.assignee,
  });

  // Always print what would be filed.
  console.log(
    [
      '',
      '='.repeat(78),
      buildSummary(candidate),
      '='.repeat(78),
      '',
      buildDescription(candidate),
      '',
    ].join('\n'),
  );

  const client = new BugzillaClient(bugzillaConfig, log);

  // The same gatekeeper the automated filer uses (static checks + live duplicate search). The
  // duplicate search only reads Bugzilla, so it runs on a dry run too.
  const verdict = await gatekeep(candidate, client);
  console.log(`\nGATEKEEPER: ${verdict.decision} — ${verdict.reason}`);

  if (verdict.decision === 'REJECT' || verdict.decision === 'ERROR') {
    // Not a fileable defect, or the dedup search failed. Either way, create nothing.
    console.log('Nothing filed.');
    return;
  }

  if (verdict.decision === 'JUDGED_NOT_DEFECT') {
    // A human already ruled on this. Re-filing would overrule them; stay silent.
    console.log('Nothing filed — a human already judged this not a defect.');
    return;
  }

  if (verdict.decision === 'DUPLICATE') {
    if (bugzillaConfig.dryRun) {
      console.log(`DRY RUN — would COMMENT on #${verdict.existingId}, not create.`);
      return;
    }
    const commented = await client.addComment(
      verdict.existingId ?? 0,
      `Seen again on ${new Date().toISOString()}.\n\n${buildDescription(candidate)}`,
    );
    console.log(`commented on #${verdict.existingId}:`, JSON.stringify(commented));
    return;
  }

  // decision === 'FILE'
  if (bugzillaConfig.dryRun) {
    console.log(`DRY RUN — would FILE a new bug. Target: ${fields.product} / ${fields.component}`);
    return;
  }
  const created = await client.createBug(fields as unknown as Record<string, unknown>);
  console.log('created:', JSON.stringify(created));
});
