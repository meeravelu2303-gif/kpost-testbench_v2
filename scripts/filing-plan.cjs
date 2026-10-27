#!/usr/bin/env node
/**
 * Prints the filing plan from the last run's REPORT.json in plain English: the review checkpoint
 * between a preview and `bug:apply`. NEEDS REVIEW items are held back; RE-CHECK BY HAND lists the
 * open bugs no run can close. Read-only.
 *
 *   npm run report:filing                 # read reports/REPORT.json
 *   npm run report:filing -- <path.json>  # read a specific report
 */
const fs = require('fs');
const path = require('path');

const file = process.argv[2] || path.join(process.cwd(), 'reports', 'REPORT.json');
if (!fs.existsSync(file)) {
  console.error(
    `No report at ${file}. Run a dry product run first (e.g. npm run product:kpost-api).`,
  );
  process.exit(1);
}
const r = JSON.parse(fs.readFileSync(file, 'utf8'));
const meta = r.meta || {};
const filing = (r.bugs && r.bugs.filing) || { entries: [], counts: {} };
const entries = filing.entries || [];
const resolved = (r.bugs && r.bugs.resolved) || {};
const rejected = (r.bugs && r.bugs.rejected) || [];

const by = (d) => entries.filter((e) => e.decision === d);
const line = (e) =>
  `    ${e.bugId ? '#' + e.bugId + ' ' : ''}[${e.id}] ${e.component ? '(' + e.component + ') ' : ''}${(e.summary || '').replace(/^\[[^\]]+\]\s*/, '').slice(0, 110)}`;

const willCreate = [...by('would-file'), ...by('created')];
const willReopen = [...by('reopened')];
const willComment = [...by('commented')];
const willAdopt = [...by('adopted')];
const needsReview = [...by('needs-review')];
const skipped = [...by('judged-skip')];
const held = [...by('failed'), ...by('capped')];

// Auto-resolve / close list (shape varies; accept array or {closed:[...]}).
const closedList = Array.isArray(resolved)
  ? resolved
  : resolved.closed || resolved.resolved || resolved.willClose || [];

const H = (s) => `\n${s}\n${'-'.repeat(s.length)}`;

function modeLabel() {
  const dryRun = [filing.dryRun, resolved.dryRun].find((v) => typeof v === 'boolean');
  if (dryRun === true) return 'DRY RUN (preview — nothing filed yet)';
  if (dryRun === false) return 'LIVE (filed)';
  return 'UNKNOWN (the report does not say — treat as not filed)';
}
console.log(`FILING PLAN — ${meta.testRunId || '(run id?)'}  ·  ${meta.generatedAt || ''}`);
console.log(
  // `filing` is null when nothing reached the filer, so the mode also comes from the status pass.
  `Mode: ${modeLabel()}  ·  Environment: ${meta.environment || '?'}`,
);

console.log(H(`WILL CREATE — brand-new bugs (${willCreate.length})`));
if (willCreate.length) willCreate.forEach((e) => console.log(line(e)));
else console.log('    (none)');

console.log(H(`WILL REOPEN — regressions of resolved bugs (${willReopen.length})`));
if (willReopen.length) willReopen.forEach((e) => console.log(line(e)));
else console.log('    (none)');

console.log(
  H(`WILL COMMENT — existing open bugs re-confirmed (${willComment.length + willAdopt.length})`),
);
[...willComment, ...willAdopt].forEach((e) => console.log(line(e)));
if (!willComment.length && !willAdopt.length) console.log('    (none)');

console.log(
  H(`WILL CLOSE — verified fixed this run (${Array.isArray(closedList) ? closedList.length : 0})`),
);
if (Array.isArray(closedList) && closedList.length) {
  closedList.forEach((c) =>
    console.log(
      `    #${c.bugId || c.id || '?'} ${(c.summary || c.reason || '').toString().slice(0, 100)}`,
    ),
  );
} else console.log('    (none — or see REPORT.json bugs.resolved)');

// Open bugs no run can close; a report written before this list existed has no `byHand`.
const byHand = resolved.byHand;
if (Array.isArray(byHand)) {
  console.log(H(`RE-CHECK BY HAND — open bugs no run can close (${byHand.length})`));
  if (byHand.length) {
    const products = new Set(byHand.map((b) => b.product));
    byHand.forEach((b) =>
      console.log(
        `    #${b.bugId} ${products.size > 1 ? b.product + ' · ' : ''}${b.component ? '(' + b.component + ') ' : ''}` +
          `${(b.summary || '').slice(0, 100)}\n        why: ${b.why}`,
      ),
    );
    console.log(
      '    Re-run the steps in each bug by hand, then close it in Bugzilla yourself if it is fixed.',
    );
  } else console.log('    (none)');
}

console.log(
  H(`>>> NEEDS YOUR REVIEW — held back, NOT filed until you approve (${needsReview.length}) <<<`),
);
if (needsReview.length)
  needsReview.forEach((e) =>
    console.log(`${line(e)}\n        reason: ${e.reason || '(no reason)'}`),
  );
else console.log('    (none — nothing is ambiguous)');

if (skipped.length) {
  console.log(H(`SKIPPED — judged not-a-defect, never refiled (${skipped.length})`));
  skipped.forEach((e) => console.log(line(e)));
}
if (held.length) {
  console.log(H(`HELD — search failed / capped (${held.length})`));
  held.forEach((e) => console.log(`${line(e)}\n        ${e.reason || ''}`));
}

const suppressed = (Array.isArray(rejected) ? rejected : []).filter((e) =>
  /known false positive/i.test(e.reason || ''),
);
const otherRejected = (Array.isArray(rejected) ? rejected : []).length - suppressed.length;
if (suppressed.length) {
  console.log(H(`SUPPRESSED — human-judged non-defects, not filed (${suppressed.length})`));
  suppressed.forEach((e) =>
    console.log(`    [${e.id}] ${(e.summary || '').slice(0, 80)}\n        ${e.reason}`),
  );
}
if (otherRejected) {
  console.log(
    H(`REJECTED — infra/transient noise, not filed (${otherRejected})`) +
      '\n    (429s, gateway 5xx, no-response, bench faults, below-severity — see REPORT.json bugs.rejected)',
  );
}

console.log(`\nSummary: ${JSON.stringify(filing.counts || {})}`);
// The same refusals bug:apply makes (src/reporting/filing-run.ts loadFilingPlan), said up front.
const filed = [filing.dryRun, resolved.dryRun].find((v) => typeof v === 'boolean') === false;
const notFiled = (r.bugs && r.bugs.notFiledReason) || '';
const review = needsReview.length
  ? ` Review the ${needsReview.length} held item(s) above; npm run bug:file-reviewed files one you approve.`
  : '';
if (filed) console.log(`\nThis run already filed to Bugzilla.${review}`);
else if (/run gate blocked/i.test(notFiled))
  console.log(
    `\nNothing from this run can be filed: ${notFiled}. Fix the cause, then run the product preview again.`,
  );
else if (!r.product || r.product === 'run')
  console.log(
    '\nThis was a one-off run, not a product command, so bug:apply will refuse it. ' +
      'Run the product preview (e.g. npm run product:kpost-api) to get a plan you can apply.',
  );
else console.log(`\nNext:${review || ' nothing needs review.'} npm run bug:apply files this plan.`);
