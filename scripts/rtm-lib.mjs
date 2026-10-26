// Requirements Traceability Matrix generator.
//
// Driven by Playwright `annotation` entries, NOT by tags:
//   'requirement'          — the test asserts the requirement's acceptance criterion;
//   'requirement-partial'  — the test exercises the requirement but asserts only part of it (an entry
//                            point, a status code, one half of a two-part rule); it links the test but
//                            the requirement can be at most Partial on this link alone;
//   'non-functional'       — security / accessibility / resilience / performance (no requirement row).
// Every requirement / requirement-partial id must exist in the docs or ASSESSED; unknown ids are listed
// on the "Unknown links" sheet (a typo or a legacy SRS id would otherwise link silently to nothing).
// Called from `scripts/lint-tags.mjs --report` with the already-listed Playwright JSON, so it adds no
// extra `--list`. Writes reports/rtm.xlsx. Pure analysis — never runs tests.
//
// Coverage definitions (applied consistently):
//   Covered     — a requirement has >=1 in-scope test linked to it (requirement annotation OR the FR id
//                 in the test title OR, for analyst-assigned RTM-* rows, a cited in-scope spec) AND the
//                 source doc marks it covered. Owner rule 2026-10-22: a correct test that fails ONLY on an
//                 open, filed bug counts as covered; its doc row says "covered (bug #N)", and the failure
//                 still shows in "Last result" / "Covered & passing", so coverage and pass rate stay apart.
//   Partial     — linked but the doc marks it partial/finding, OR the doc claims covered but only a
//                 file-level (not assertion) link resolves.
//   Not covered — nothing links it.
// "Covered and passing" additionally requires the linked test(s) to have passed in the latest regression
// report (reports/<level>/<suite>/<ts>/report.json); otherwise flaky / failed / not run.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const norm = (f) => String(f).replace(/\\/g, '/');
const base = (f) => norm(f).split('/').pop();
// Canonicalise a spec path to its testDir-relative form (the `--list` reporter already emits this
// form, e.g. "api/kpost/x.spec.ts"; the regression report.json emits absolute paths). Keying both on
// this makes "Last result" line up.
const canon = (f) =>
  norm(f)
    .replace(/.*\/tests\//, '')
    .replace(/^tests\//, '');

// ---------- requirement-id helpers ----------
export function expandIds(id) {
  if (id.includes('/')) return id.split('/').flatMap(expandIds);
  const m = id.match(/^([A-Z]+-[A-Z]+)-(\d+)\.\.(\d+)$/);
  if (m) {
    const [, pre, a, b] = m;
    const w = a.length,
      out = [];
    for (let i = +a; i <= +b; i++) out.push(`${pre}-${String(i).padStart(w, '0')}`);
    return out;
  }
  return [id];
}
const ID_RE = /\b(?:FR|BR|NFR)-[A-Z0-9][A-Z0-9-]*\b/g;

// ---------- in-scope filter (mirror of test-scope.mjs; kept local to avoid ESM path pain) ----------
const isAdminPath = (f) => /e2e-admin|\/admin\/|(^|\/)admin[-.]/.test(norm(f));
const isAdminTags = (t) =>
  t.some((x) => /^@admin|workplace|hr-tier|employee|role-posting/i.test(x));
const isMetaPath = (f) => /\.setup\.ts$|(^|\/)framework\//.test(norm(f));
const isMetaTags = (t) => t.includes('@framework');
const suiteOf = (f) => (/(^|\/)e2e\//.test(norm(f)) ? 'ui' : 'api');
const normTags = (t) => [...new Set((t || []).map((x) => (x.startsWith('@') ? x : `@${x}`)))];

// ---------- markdown requirement-table parser ----------
const MODMAP = (h) => {
  const s = h.toLowerCase();
  if (/signup|login/.test(s)) return 'Signup/Login';
  if (/katchup.*group|^group|group —|group -/.test(s)) return 'Group';
  if (/katchup/.test(s)) return 'Katchup';
  if (/\bkall\b/.test(s)) return 'Kall';
  if (/kmail/.test(s)) return 'KMail';
  if (/kdirectory|directory/.test(s)) return 'KDirectory';
  if (/admin|hr-setup/.test(s)) return 'Admin(ref)';
  if (/cross-cutting/.test(s)) return 'Cross-cutting';
  if (/kdoc/.test(s)) return 'KDOC';
  return 'General';
};
function parseTables(md) {
  const lines = md.split(/\r?\n/);
  let module = 'General';
  const rows = [];
  for (const line of lines) {
    const h = line.match(/^##\s+(.*)/);
    if (h) module = MODMAP(h[1]);
    if (/^\|/.test(line) && !/^\|\s*:?-{2,}/.test(line)) {
      const cells = line
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim());
      const first = (cells[0] || '').trim();
      if (first === 'FR' || first === 'Rule' || first === '') continue;
      if (cells.length >= 3) rows.push({ module, cells });
    }
  }
  return rows;
}
function whereTokens(text) {
  const BARE = new Set([
    'home',
    'shell',
    'navigation',
    'login',
    'katchup',
    'group',
    'profile',
    'contacts',
    'kall',
    'kmail',
    'crawl',
    'visual',
  ]);
  const toks = new Set();
  for (const m of text.matchAll(/`([^`]+)`/g))
    for (const raw of m[1].split(/[\s,]+|\s+\+\s+/)) {
      // Strip wrapping punctuation only — an inner dot is part of the name ("katchup-actions.spec.ts").
      const p = raw.trim().replace(/[`()]/g, '').replace(/\.+$/, '');
      if (!p) continue;
      if (
        /\.spec(\.ts)?$/.test(p) ||
        (p.includes('/') && /^[a-z]/i.test(p)) ||
        /-(spec|flow|info|actions|controls|compose|targeting|photo|launch|recall|repost|received|nav|axe|crawl|features|two-session|attach|send|sweep|composer)/i.test(
          p,
        ) ||
        BARE.has(p.toLowerCase())
      )
        toks.add(p.replace(/\.spec\.ts$|\.spec$|\.ts$/g, ''));
    }
  return [...toks];
}

// ---------- analyst-assigned requirements for areas the FRD is silent on ----------
import { ASSESSED } from './rtm-assessed.mjs';

// ---------- latest regression report → file::title -> status ----------
function loadLastResults(root) {
  const base = path.join(root, 'reports');
  const map = new Map();
  let picked = null;
  for (const level of ['regression']) {
    const dir = path.join(base, level);
    if (!fs.existsSync(dir)) continue;
    for (const suite of fs.readdirSync(dir)) {
      const sdir = path.join(dir, suite);
      if (!fs.statSync(sdir).isDirectory()) continue;
      const stamps = fs
        .readdirSync(sdir)
        .filter((d) => fs.existsSync(path.join(sdir, d, 'report.json')))
        .sort();
      if (stamps.length) {
        const file = path.join(sdir, stamps[stamps.length - 1], 'report.json');
        picked = picked ? picked + ', ' + path.relative(base, file) : path.relative(base, file);
        try {
          const j = JSON.parse(fs.readFileSync(file, 'utf8'));
          const walk = (s) => {
            for (const sp of s.specs || [])
              for (const t of sp.tests || []) {
                const r = (t.results || [])[t.results.length - 1];
                let st = 'not run';
                if (r)
                  st =
                    r.status === 'passed'
                      ? t.results.length > 1
                        ? 'flaky'
                        : 'pass'
                      : r.status === 'skipped'
                        ? 'skipped'
                        : 'fail';
                map.set(`${canon(sp.file)}::${sp.title}`, st);
              }
            for (const c of s.suites || []) walk(c);
          };
          (j.suites || []).forEach(walk);
        } catch {
          /* ignore unreadable */
        }
      }
    }
  }
  return { map, picked };
}

export async function generateRtm({ report, root }) {
  // 1) Flatten report → in-scope tests with tags + annotations (dedupe file::title).
  const seen = new Map();
  const walk = (s) => {
    for (const sp of s.specs || []) {
      const key = `${norm(sp.file)}::${sp.title}`;
      const anns = seen.get(key)?.anns || [];
      for (const t of sp.tests || []) for (const a of t.annotations || []) anns.push(a);
      seen.set(key, { file: norm(sp.file), title: sp.title, tags: normTags(sp.tags), anns });
    }
    for (const c of s.suites || []) walk(c);
  };
  for (const s of report.suites || []) walk(s);

  const inScope = [];
  for (const r of seen.values()) {
    if (isMetaPath(r.file) || isMetaTags(r.tags) || isAdminPath(r.file) || isAdminTags(r.tags))
      continue;
    const reqAnns = r.anns.filter((a) => a.type === 'requirement').map((a) => a.description);
    const partialAnns = r.anns
      .filter((a) => a.type === 'requirement-partial')
      .map((a) => a.description);
    const nfr = r.anns.some((a) => a.type === 'non-functional');
    const titleIds = r.title.match(ID_RE) || [];
    inScope.push({
      key: `${r.file}::${r.title}`,
      file: r.file,
      title: r.title,
      suite: suiteOf(r.file),
      reqAnns: [...new Set(reqAnns)],
      partialAnns: [...new Set(partialAnns)],
      nfr,
      titleIds,
    });
  }

  // contract-matrix generators are non-functional by path (not annotated in source).
  for (const t of inScope)
    if (/src\/validation-engine\/(endpoint-cases|contract-suite)/.test(t.file)) t.nfr = true;

  // index: concrete req id -> linked in-scope tests
  const linkIndex = new Map();
  const inScopeAdminPartials = [];
  const addLink = (id, t) => {
    if (!linkIndex.has(id)) linkIndex.set(id, new Set());
    linkIndex.get(id).add(t);
  };
  for (const t of inScope) {
    for (const id of t.reqAnns) addLink(id, t);
    for (const id of t.titleIds) addLink(id, t);
  }
  // The Admin(ref) rows (BR-ADM-*) can only ever be proven by the Admin suite, which is otherwise out
  // of this KPost scope: link Admin tests to those rows alone (they stay out of orphans/scope counts).
  for (const r of seen.values()) {
    if (!(isAdminPath(r.file) || isAdminTags(r.tags)) || isMetaPath(r.file)) continue;
    const ids = (kind) =>
      r.anns
        .filter((a) => a.type === kind && /^BR-ADM-/.test(a.description))
        .map((a) => a.description);
    const t = {
      key: `${r.file}::${r.title}`,
      file: r.file,
      title: r.title,
      suite: 'api',
      reqAnns: [],
      partialAnns: [],
      nfr: false,
      titleIds: [],
    };
    for (const id of new Set(ids('requirement'))) addLink(id, t);
    for (const id of new Set(ids('requirement-partial'))) t.partialAnns.push(id);
    if (t.partialAnns.length) inScopeAdminPartials.push(t);
  }
  // partial links: req id -> tests that exercise it without asserting the whole criterion
  const partialIndex = new Map();
  for (const t of inScopeAdminPartials)
    for (const id of t.partialAnns) {
      if (!partialIndex.has(id)) partialIndex.set(id, new Set());
      partialIndex.get(id).add(t);
    }
  for (const t of inScope)
    for (const id of t.partialAnns) {
      if (!partialIndex.has(id)) partialIndex.set(id, new Set());
      partialIndex.get(id).add(t);
    }
  const byFile = new Map();
  for (const t of inScope) {
    if (!byFile.has(t.file)) byFile.set(t.file, []);
    byFile.get(t.file).push(t);
  }

  const { map: lastResults, picked } = loadLastResults(root);
  const resultOf = (t) => lastResults.get(t.key) || 'not run';
  const aggResult = (tests) => {
    const ss = tests.map(resultOf);
    if (ss.includes('fail')) return 'fail';
    if (ss.includes('flaky')) return 'flaky';
    if (ss.includes('pass')) return 'pass';
    if (ss.length && ss.every((s) => s === 'skipped')) return 'skipped';
    return 'not run';
  };

  // 2) requirements from docs
  const reqRows = [];
  const frd = parseTables(
    fs.readFileSync(path.join(root, 'docs/reference/requirements-frd.md'), 'utf8'),
  );
  for (const { module, cells } of frd) {
    // Some rows are bolded for emphasis (`**FR-KU-017..024**`) — unwrap before matching the id.
    const [fr, title, status, where] = cells.map((c) => c.replace(/\*\*/g, '').trim());
    if (!/^(FR|NFR|BR)/.test(fr)) continue;
    reqRows.push({ id: fr, module, summary: title, docStatus: status, where: where || '' });
  }
  const br = parseTables(
    fs.readFileSync(path.join(root, 'docs/reference/business-rules.md'), 'utf8'),
  );
  for (const { module, cells } of br) {
    const [rule, applies, , status, spec] = cells;
    const m = rule.match(/\*\*([A-Z0-9-]+(?:\s*\/\s*[A-Z0-9-]+)?)\*\*/);
    if (!m) continue;
    reqRows.push({
      id: m[1].replace(/\s/g, ''),
      module,
      summary: (rule.replace(/\*\*[^*]+\*\*\s*—?\s*/, '').trim() || rule).slice(0, 160),
      docStatus: status,
      where: spec || '',
      applies,
    });
  }

  const priority = (module, title) => {
    const s = (title + ' ' + module).toLowerCase();
    if (
      /(login|password|logout|token|jwt|session|confidential|idor|recall|receipt|auth|security|delete|activation|enum|send|compose|call|kall|mail|message|member|admin|attach|priority|recipient|group create)/.test(
        s,
      )
    )
      return 'P1';
    if (
      /(edit|forward|reminder|note|schedule|formatting|salutation|subject|search|count|profile|photo|crop)/.test(
        s,
      )
    )
      return 'P2';
    if (/(tts|speech|full-?screen|copy|save|transfer|visual|crawl|axe|keyboard|emoji)/.test(s))
      return 'P3';
    return 'P2';
  };
  const docBucket = (raw) => {
    const s = raw.toLowerCase();
    if (/out-of-scope|⛔|out of scope|n\/a by design/.test(s)) return 'OOS';
    if (/partial|🟡/.test(s)) return 'Partial';
    if (/(gap|⬜|to ?do|untestable|broken|violated|finding)/.test(s) && !/covered/.test(s))
      return 'Partial';
    if (/covered|✅/.test(s)) return 'Covered';
    return 'Partial';
  };

  const matched = new Set();
  const out = [];
  const reviewLinks = [];

  function evaluate(id, module, summary, docStatusRaw, where, assignedStatus, assignedFiles) {
    const idSet = new Set(expandIds(id).concat(id));
    const linked = new Set();
    for (const i of idSet) for (const t of linkIndex.get(i) || []) linked.add(t);
    if (assignedFiles)
      for (const tok of assignedFiles)
        for (const f of byFile.keys())
          if (f.includes(tok)) byFile.get(f).forEach((t) => linked.add(t));
    const fullLinks = linked.size;
    for (const i of idSet) for (const t of partialIndex.get(i) || []) linked.add(t);
    const bucket = assignedStatus
      ? assignedStatus === 'Out of scope'
        ? 'OOS'
        : assignedStatus
      : docBucket(docStatusRaw);
    let status;
    if (bucket === 'OOS') status = 'Out of scope';
    else if (fullLinks > 0) status = bucket === 'Covered' ? 'Covered' : 'Partial';
    else if (linked.size > 0)
      status = 'Partial'; // only requirement-partial links
    else {
      const files = whereTokens(where).flatMap((tok) =>
        [...byFile.keys()].filter((f) => f.replace(/\.spec\.ts$/, '').includes(tok)),
      );
      if (bucket === 'Covered') {
        if (files.length) {
          status = 'Partial'; // doc claimed covered; a spec file exists in-scope but no assertion-level link — needs review
          reviewLinks.push({
            'Req ID': id,
            Module: module,
            'Candidate test file': base(files[0]),
            Confidence: 'medium',
            Evidence:
              'FRD "Where" names this spec; assertion not auto-verified — approve to annotate',
            Suggested: `annotation requirement ${id}`,
          });
          files.forEach((f) => linked.add(byFile.get(f)[0]) || matched.add(f));
        } else status = 'Not covered';
      } else status = bucket === 'Partial' ? 'Partial' : 'Not covered';
    }
    [...linked].forEach((t) => matched.add(t.file));
    const covering = [...linked]
      .slice(0, 6)
      .map((t) => `${base(t.file)} › ${t.title.split(' › ').pop()}`);
    const last = aggResult([...linked]);
    return {
      'Req ID': id,
      Module: module,
      Requirement: summary,
      Priority: status === 'Out of scope' ? '—' : priority(module, summary),
      'Covering tests':
        covering.join(' | ') + (linked.size > 6 ? ` | +${linked.size - 6} more` : ''),
      '# tests': linked.size,
      Layer:
        [...new Set([...linked].map((t) => (t.suite === 'ui' ? 'UI' : 'API')))].join('+') || '—',
      Status: status,
      'Last result': status === 'Out of scope' ? '—' : last,
      'Covered & passing':
        status === 'Covered' && last === 'pass' ? 'yes' : status === 'Covered' ? 'no' : '—',
      Notes:
        (assignedStatus ? '[assigned] ' : '') + docStatusRaw.replace(/\s+/g, ' ').slice(0, 260),
    };
  }

  for (const r of reqRows)
    out.push(
      evaluate(
        r.id,
        r.module,
        r.summary,
        r.docStatus,
        r.where + ' ' + (r.applies || ''),
        null,
        null,
      ),
    );
  for (const a of ASSESSED)
    out.push(evaluate(a.id, a.module, a.summary, a.notes, '', a.status, a.files));

  // 3) orphans = in-scope tests with NO requirement link AND NO non-functional annotation
  const linkedKeys = new Set();
  for (const set of linkIndex.values()) for (const t of set) linkedKeys.add(t.key);
  for (const set of partialIndex.values()) for (const t of set) linkedKeys.add(t.key);

  // 3a) annotation ids that match no requirement row (typos, legacy SRS ids, free text)
  const knownIds = new Set();
  for (const r of out) for (const i of expandIds(r['Req ID']).concat(r['Req ID'])) knownIds.add(i);
  const unknownRows = [];
  for (const t of inScope)
    for (const [type, ids] of [
      ['requirement', t.reqAnns],
      ['requirement-partial', t.partialAnns],
    ])
      for (const id of ids)
        if (!knownIds.has(id) && !expandIds(id).every((i) => knownIds.has(i)))
          unknownRows.push({ 'Annotation id': id, Type: type, File: t.file, Test: t.title });
  const orphanRows = [];
  for (const t of inScope) {
    if (linkedKeys.has(t.key)) continue;
    if (t.nfr) continue;
    if (matched.has(t.file)) continue; // file-level review-link match
    orphanRows.push({
      Suite: t.suite.toUpperCase(),
      File: t.file,
      Test: t.title.split(' › ').slice(-2).join(' › '),
    });
  }
  // low-confidence review links for orphan feature files (module heuristic)
  const orphanFiles = [...new Set(orphanRows.map((o) => o.File))];
  const moduleGuess = (f) =>
    (f.match(
      /(katchup|kmail|kall|group|contacts|profile|settings|home|signup-login|dashboard|aws|kbooking|kdiary|knews|concurrency|verticals)/,
    ) || ['', '?'])[1];
  for (const f of orphanFiles)
    reviewLinks.push({
      'Req ID': '(propose)',
      Module: moduleGuess(f),
      'Candidate test file': base(f),
      Confidence: 'low',
      Evidence: `${byFile.get(f).length} in-scope test(s), not FR-linked`,
      Suggested: 'annotate requirement, or add FRD requirement (see docs/proposals/frd-updates.md)',
    });

  // 4) summaries
  const bucketOf = (s) =>
    s.startsWith('Covered')
      ? 'Covered'
      : s === 'Partial'
        ? 'Partial'
        : s === 'Out of scope'
          ? 'Out of scope'
          : 'Not covered';
  const perModule = {};
  for (const r of out) {
    const m = r.Module;
    perModule[m] = perModule[m] || {
      Covered: 0,
      'Cov&pass': 0,
      Partial: 0,
      'Not covered': 0,
      'Out of scope': 0,
      total: 0,
    };
    perModule[m][bucketOf(r.Status)]++;
    perModule[m].total++;
    if (r['Covered & passing'] === 'yes') perModule[m]['Cov&pass']++;
  }
  const summaryRows = Object.entries(perModule)
    .sort()
    .map(([m, c]) => {
      const inS = c.total - c['Out of scope'];
      return {
        Module: m,
        Requirements: c.total,
        Covered: c.Covered,
        'Covered & passing': c['Cov&pass'],
        Partial: c.Partial,
        'Not covered': c['Not covered'],
        'Out of scope': c['Out of scope'],
        'Coverage % (excl OOS)': inS ? Math.round((c.Covered / inS) * 100) + '%' : '—',
      };
    });
  const inScopeReqs = out.filter((r) => r.Status !== 'Out of scope').length;
  const covered = out.filter((r) => bucketOf(r.Status) === 'Covered').length;
  const covPass = out.filter((r) => r['Covered & passing'] === 'yes').length;
  const partial = out.filter((r) => r.Status === 'Partial').length;
  const overall = Math.round((covered / inScopeReqs) * 100);

  // 5) write workbook
  const require = createRequire(import.meta.url);
  const XLSX = require('xlsx');
  const wb = XLSX.utils.book_new();
  const over = [
    { A: 'KPost RTM — annotation-driven requirements traceability (in-scope run-level tests)' },
    {
      A: `Generated ${new Date().toISOString().slice(0, 10)} · requirement links from Playwright annotations + FR ids in titles`,
    },
    {
      A: `Verified coverage (excl OOS): ${covered}/${inScopeReqs} = ${overall}% Covered · ${covPass} Covered & passing · ${partial} Partial`,
    },
    {
      A: `Orphans (no requirement & no non-functional annotation): ${orphanRows.length} tests / ${orphanFiles.length} files · Review links pending: ${reviewLinks.length}`,
    },
    {
      A: `Annotation ids matching no requirement row: ${unknownRows.length} (see "Unknown links")`,
    },
    { A: `Last-result source: ${picked || '(no regression report found — all "not run")'}` },
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(over, { skipHeader: true }),
    'Overview',
  );
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'Summary (module)');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(out), 'RTM');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(reviewLinks), 'Review links');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(orphanRows), 'Orphan tests');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(unknownRows), 'Unknown links');
  fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
  XLSX.writeFile(wb, path.join(root, 'reports/rtm.xlsx'));

  return {
    overall,
    covered,
    covPass,
    partial,
    inScopeReqs,
    totalRows: out.length,
    orphanTests: orphanRows.length,
    orphanFiles: orphanFiles.length,
    reviewPending: reviewLinks.length,
    reviewMedium: reviewLinks.filter((r) => r.Confidence === 'medium').length,
    reviewLow: reviewLinks.filter((r) => r.Confidence === 'low').length,
    unknownIds: unknownRows.length,
    unknownRows,
    summaryRows,
    lastResultSource: picked,
  };
}
