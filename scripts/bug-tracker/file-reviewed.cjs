#!/usr/bin/env node
/**
 * Files the NEEDS-REVIEW findings you approve after `npm run report:filing`, with the exact ticket
 * text stored in the dry-run REPORT.json. Dry by default; every create is preceded by a live
 * duplicate check on its `[KP-]` tag.
 *
 *   npm run bug:file-reviewed -- KP-A082D1              # preview one (dry — writes nothing)
 *   npm run bug:file-reviewed -- KP-A082D1 KP-81C8F4    # preview several
 *   npm run bug:file-reviewed -- KP-A082D1 --live        # actually file it
 */
require(require('node:path').join(__dirname, '..', '..', 'node_modules', 'dotenv')).config({
  path: require('node:path').join(__dirname, '..', '..', '.env'),
  quiet: true,
});
const fs = require('fs');
const path = require('path');

const LIVE = process.argv.includes('--live');
const ids = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const reportPath = path.join(process.cwd(), 'reports', 'REPORT.json');

if (!ids.length) {
  console.error('Usage: npm run bug:file-reviewed -- <KP-xxxxxx> [more ids] [--live]');
  console.error('Pick the ids from the NEEDS YOUR REVIEW section of `npm run report:filing`.');
  process.exit(1);
}
if (!fs.existsSync(reportPath)) {
  console.error(`No report at ${reportPath}. Run the product dry run first.`);
  process.exit(1);
}
const BZ = (process.env.BUGZILLA_URL || '').replace(/\/+$/, '');
const KEY = process.env.BUGZILLA_API_KEY;
if (!BZ || !KEY) {
  console.error('BUGZILLA_URL / BUGZILLA_API_KEY not configured in .env');
  process.exit(1);
}

const r = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const entries = (r.bugs && r.bugs.filing && r.bugs.filing.entries) || [];
const candidates = (r.bugs && r.bugs.candidates) || [];

const SEVERITY = { CRITICAL: 'critical', HIGH: 'major', MEDIUM: 'minor', LOW: 'trivial' };
const PRIORITY = { CRITICAL: 'Highest', HIGH: 'High', MEDIUM: 'Normal', LOW: 'Low' };

/** The whiteboard exactly as bug-builder.ts buildWhiteboard writes it: [cat:][browser:][source:]. */
function whiteboardFor(cand) {
  const tags = [`[cat:${(cand && cand.category) || 'Functional'}]`];
  const browsers = [
    ...new Set(((cand && cand.browsers) || []).map((b) => (b === 'admin-ui' ? 'chromium' : b))),
  ].sort();
  if (browsers.length) tags.push(`[browser:${browsers.join(',')}]`);
  tags.push('[source:automation]');
  return tags.join('');
}

async function bz(method, p, body) {
  const sep = p.includes('?') ? '&' : '?';
  const res = await fetch(`${BZ}${p}${sep}api_key=${encodeURIComponent(KEY)}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return res.json().catch(() => ({}));
}

async function existingWithTag(tag) {
  const q = encodeURIComponent(`ALL "[${tag}]"`);
  const j = await bz('GET', `/bug?quicksearch=${q}&include_fields=id,status,resolution,summary`);
  return (j.bugs || []).filter((b) => (b.summary || '').includes(`[${tag}]`));
}

async function main() {
  console.log(
    LIVE
      ? '=== LIVE — filing approved review items ===\n'
      : '=== DRY — preview only (add --live to file) ===\n',
  );
  let filed = 0;
  for (const rawId of ids) {
    const id = rawId.replace(/^\[|\]$/g, '').toUpperCase();
    const entry = entries.find((e) => (e.id || '').toUpperCase() === id);
    console.log(`--- ${id} ---`);
    if (!entry) {
      console.log('  NOT in this report — check the id against report:filing.\n');
      continue;
    }
    if (entry.decision !== 'needs-review') {
      console.log(
        `  decision is "${entry.decision}", not needs-review — the normal :file run handles it. Skipping.\n`,
      );
      continue;
    }
    if (!entry.description) {
      console.log(
        '  entry carries no prepared ticket text (not a dry-run report?) — cannot file safely. Skipping.\n',
      );
      continue;
    }
    const dupes = await existingWithTag(id);
    if (dupes.length) {
      console.log('  ALREADY TRACKED — not creating a duplicate:');
      for (const d of dupes)
        console.log(`    #${d.id} ${d.status}/${d.resolution || '-'} ${d.summary.slice(0, 90)}`);
      console.log('  (If it is RESOLVED and this is a regression, reopen that id instead.)\n');
      continue;
    }
    const cand = candidates.find((c) => (c.id || '').toUpperCase() === id);
    const fields = {
      product: entry.product,
      component: entry.component,
      summary: entry.summary,
      version: (cand && cand.version) || 'unspecified',
      description: `${entry.description}\n\nFiled after manual review (held as needs-review: ${entry.reason || 'see report'}).`,
      severity: SEVERITY[entry.severity] || 'major',
      priority: PRIORITY[entry.severity] || 'High',
      op_sys: 'All',
      platform: 'All',
      status_whiteboard: whiteboardFor(cand),
      assigned_to: entry.assignee || undefined,
    };
    if (!LIVE) {
      console.log(`  WOULD CREATE: ${fields.summary}`);
      console.log(
        `    product=${fields.product} component=${fields.component} severity=${fields.severity} whiteboard=${fields.status_whiteboard}\n`,
      );
      continue;
    }
    const res = await bz('POST', '/bug', fields);
    if (res.id) {
      console.log(`  CREATED #${res.id} — ${fields.summary}\n`);
      filed += 1;
    } else {
      console.log(`  CREATE FAILED: ${JSON.stringify(res).slice(0, 300)}\n`);
    }
  }
  console.log(LIVE ? `Done — ${filed} filed.` : 'Dry preview done — nothing written.');
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
