import { readFileSync } from 'node:fs';
import { readBugzillaConfig } from '@config/bugzilla.config';
import { createLogger } from '@utils/logger';
import { test } from '@playwright/test';
import { buildBugFields, buildDescription, buildSummary } from '../../src/bug-tracker/bug-builder';
import { BugzillaClient } from '../../src/bug-tracker/bugzilla-client';
import { gatekeep } from '../../src/bug-tracker/gatekeeper';
import type { BugCandidate } from '../../src/bug-tracker/bug-candidate';

/**
 * The single supported way to file a bug BY HAND.
 *
 * ## Why this exists
 *
 * Most defects are filed by the engine, which formats them through `buildDescription()`. Findings
 * reached by investigation — a defect proved with a database query, a control matrix, or a chain of
 * calls the engine does not model — have no candidate object, and were being filed with ad-hoc
 * curl scripts. Six tickets went in that way and none of them matched the layout of the several
 * hundred already in the tracker: no Classification, no Module, no Owner, no Filed-by, and
 * headings invented per ticket.
 *
 * Every filing now goes through the same three functions the engine uses — `buildSummary()`,
 * `buildDescription()`, `buildBugFields()` — so a hand-filed ticket is indistinguishable in shape
 * from a generated one, carries the fingerprint tag that deduplication depends on, and gets the
 * severity and priority mapping from one place. The format cannot drift, because there is no second
 * copy of it.
 *
 * ## Usage
 *
 *   npm run bug:preview -- --bug=path/to/finding.json     # render it, file nothing
 *   npm run bug:file    -- --bug=path/to/finding.json     # actually file it
 *
 * The JSON is a partial `BugCandidate`. The fields below are required; everything else has a
 * sensible default. See `src/bug-tracker/bug-candidate.ts` for the full shape.
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
 * Strongly encouraged, and the reason several earlier tickets were weak without them:
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

/*
 * The pipeline's severity scale is CRITICAL | HIGH | MEDIUM | LOW | INFO, but a human writing a
 * finding naturally reaches for Bugzilla's words (blocker, major, normal). Accept both and normalise
 * to the internal scale, so a finding written as "MAJOR" is not silently rejected by the severity
 * floor (SEVERITY_RANK has no "MAJOR" key, so it would rank as undefined and fail every comparison).
 */
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

  /*
   * Defaults for the bookkeeping fields. They exist so a hand-written finding does not have to
   * restate the environment on every filing, and so the "Filed by" line is always present — its
   * absence is one of the things that made the earlier hand-filed tickets look unlike the rest.
   */
  return {
    source: 'api',
    suiteId: 'kpost-api',
    title: String(raw.id),
    category: 'Functional',
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

test('file a hand-authored finding through the standard formatter', async () => {
  /*
   * Inert unless a finding is supplied. This spec lives in the framework project so it can reuse the
   * bench's TypeScript and its Bugzilla client, which means `npm run framework` picks it up like
   * any other spec — and a tool that fails the suite when nobody asked it to do anything is a tool
   * people delete.
   */
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

  // Always print what would be filed. A ticket nobody read before sending is how a bad one gets in.
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

  /*
   * THE GATEKEEPER. Both the static checks (evidence, validity, reproduction) and the live duplicate
   * check run here — the same decision the automated filer makes, so filing by hand cannot slip
   * anything past a check the engine would have enforced.
   *
   * On a dry run the live half still runs (it only READS Bugzilla), so the preview tells the truth:
   * it shows FILE / REJECT / DUPLICATE / JUDGED before anything is created.
   */
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
