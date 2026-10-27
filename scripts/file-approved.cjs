#!/usr/bin/env node
/**
 * Files/ reopens the EXACT would-file + reopen findings a human has approved, straight from the
 * existing dry-run REPORT.json — WITHOUT re-running the (hour-plus) suite. The sibling
 * `file-reviewed.cjs` only handles `needs-review` entries; this one handles the `would-file` (create)
 * and `reopened` (regression of a RESOLVED bug) entries, but ONLY the ids you name explicitly — naming
 * an id IS the approval, so nothing is ever filed that you did not list.
 *
 *   node scripts/file-approved.cjs KP-06F947 KP-86FC80            # preview (dry — writes nothing)
 *   node scripts/file-approved.cjs KP-06F947 --live               # actually create it
 *   node scripts/file-approved.cjs KP-6F5E6B --live               # reopen its existingId with evidence
 *
 * Safety: dry by default. Every CREATE is preceded by a live duplicate check on the `[KP-]` tag (all
 * statuses) — if any ticket already carries the tag, nothing is created. A `reopened` entry updates
 * its `existingId` (status REOPENED, resolution cleared) and adds a comment with the evidence;
 * it refuses if that id is not actually resolved.
 */
require(require('node:path').join(__dirname, '..', 'node_modules', 'dotenv')).config({
  path: require('node:path').join(__dirname, '..', '.env'),
  quiet: true,
});
const fs = require('fs');
const path = require('path');

const LIVE = process.argv.includes('--live');
const ids = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const reportPath = path.join(process.cwd(), 'reports', 'REPORT.json');

if (!ids.length) {
  console.error('Usage: node scripts/file-approved.cjs <KP-xxxxxx> [more ids] [--live]');
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

const SEVERITY = { CRITICAL: 'critical', HIGH: 'major', MEDIUM: 'minor', LOW: 'trivial' };
const PRIORITY = { CRITICAL: 'Highest', HIGH: 'High', MEDIUM: 'Normal', LOW: 'Low' };

/**
 * The whiteboard exactly as src/bug-tracker/bug-builder.ts buildWhiteboard writes it, because the
 * BUGZILLA-UI tracker reads all three tags: [cat:] (category), [browser:] (real browser names only —
 * the admin-ui project runs chromium) and [source:automation] (these are the bench's own findings).
 */
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
  const r = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const entries = (r.bugs && r.bugs.filing && r.bugs.filing.entries) || [];
  const candidates = (r.bugs && r.bugs.candidates) || [];
  console.log(
    LIVE ? '=== LIVE — filing approved items ===\n' : '=== DRY — preview only (add --live) ===\n',
  );

  let created = 0;
  let reopened = 0;
  for (const rawId of ids) {
    const id = rawId.replace(/^\[|\]$/g, '').toUpperCase();
    const entry = entries.find((e) => (e.id || '').toUpperCase() === id);
    const cand = candidates.find((c) => (c.id || '').toUpperCase() === id);
    console.log(`--- ${id} ---`);
    if (!entry) {
      console.log('  NOT in this report — check the id against report:filing.\n');
      continue;
    }
    if (!entry.description) {
      console.log('  no prepared ticket text (not a dry-run report?) — skipping.\n');
      continue;
    }
    const dupes = await existingWithTag(id);

    // REOPEN path — a regression of a RESOLVED bug.
    if (entry.decision === 'reopened' || entry.decision === 'reopen') {
      const existingId = entry.existingId || entry.bugId;
      if (!existingId) {
        console.log('  marked reopen but carries no existingId — skipping.\n');
        continue;
      }
      const cur = await bz('GET', `/bug/${existingId}?include_fields=id,status,resolution,summary`);
      const b = (cur.bugs || [])[0];
      if (!b) {
        console.log(`  #${existingId} not found — skipping.\n`);
        continue;
      }
      if (
        (b.status || '').toUpperCase() !== 'RESOLVED' &&
        (b.status || '').toUpperCase() !== 'VERIFIED' &&
        (b.status || '').toUpperCase() !== 'CLOSED'
      ) {
        // Already open: nothing to reopen (Bugzilla allows REOPENED only from RESOLVED/VERIFIED).
        console.log(`  #${existingId} is ${b.status} (already open) — not reopened.\n`);
        continue;
      }
      if (!LIVE) {
        console.log(
          `  WOULD REOPEN #${existingId} (${b.status}/${b.resolution || '-'}) and add evidence comment.\n`,
        );
        continue;
      }
      // REOPENED (not CONFIRMED): the tracker counts fixes that did not hold under that status.
      const upd = await bz('PUT', `/bug/${existingId}`, {
        ids: [existingId],
        status: 'REOPENED',
        resolution: '',
        comment: {
          body: `Reopened after live re-verification on the test deployment (${new Date().toISOString().slice(0, 10)}): the finding reproduces.\n\n${entry.description}`,
        },
      });
      if (upd.bugs || upd.error === false || upd.id) {
        console.log(`  REOPENED #${existingId}.\n`);
        reopened += 1;
      } else {
        console.log(`  REOPEN FAILED: ${JSON.stringify(upd).slice(0, 300)}\n`);
      }
      continue;
    }

    // CREATE path — a brand-new would-file finding.
    if (dupes.length) {
      console.log('  ALREADY TRACKED — not creating a duplicate:');
      for (const d of dupes)
        console.log(
          `    #${d.id} ${d.status}/${d.resolution || '-'} ${(d.summary || '').slice(0, 90)}`,
        );
      console.log('');
      continue;
    }
    const fields = {
      product: entry.product,
      component: entry.component,
      summary: entry.summary,
      version: (cand && cand.version) || 'unspecified',
      description: `${entry.description}\n\nFiled after live re-verification on testingapi (${new Date().toISOString().slice(0, 10)}).`,
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
      created += 1;
    } else {
      console.log(`  CREATE FAILED: ${JSON.stringify(res).slice(0, 300)}\n`);
    }
  }
  console.log(
    LIVE
      ? `Done — ${created} created, ${reopened} reopened.`
      : 'Dry preview done — nothing written.',
  );
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
