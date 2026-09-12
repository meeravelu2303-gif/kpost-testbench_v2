#!/usr/bin/env node
/**
 * Lists every workbook row that is missing data the bench needs, so the gaps can be filled in
 * the spreadsheet itself.
 *
 *   npm run contract:gaps
 *
 * Reads the parsed contracts (not the .xlsx), so it re-runs in a second after every new dump:
 *
 *   contracts/excel-gaps.csv   one row per endpoint, with Tab + Row to find the cell. Opens in Excel.
 *   contracts/excel-gaps.md    the same thing summarised, to read or paste into a message.
 *
 * ## The `SuggestedMethod` column is a HINT, never a decision
 *
 * It is guessed from the endpoint's name (`getX` → GET, `saveX` → POST) purely to make filling
 * 200+ rows faster. The converter ignores it completely: a method only ever comes from the
 * workbook. Confirm each one before pasting it in — a wrong verb turns into a test that blames
 * the API for a spreadsheet mistake.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONTRACTS = path.join(ROOT, 'contracts');

const files = ['kpost-api.contract.json', 'kmail-api.contract.json'];
const missing = files.filter((f) => !fs.existsSync(path.join(CONTRACTS, f)));
if (missing.length) {
  console.error(`missing ${missing.join(', ')} — run "npm run contract:excel" first`);
  process.exit(2);
}

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);
const READ_VERBS = /^(get|fetch|list|load|view|check|is|count|download|export|search|read|status)/i;
const WRITE_VERBS =
  /^(add|create|save|update|edit|delete|remove|send|post|upload|set|change|forgot|reset|login|logout|signup|validate|verify|block|unblock|share|forward|reply|convert|generate|mark|clear|move|import)/i;

/** A hint only — the converter never reads this. */
function suggestMethod(record) {
  const token = (record.name || record.path.split('/').filter(Boolean).pop() || '').replace(
    /[^A-Za-z]/g,
    '',
  );
  if (READ_VERBS.test(token)) return 'GET?';
  if (WRITE_VERBS.test(token)) return 'POST?';
  return '';
}

const rows = [];
for (const file of files) {
  const contract = JSON.parse(fs.readFileSync(path.join(CONTRACTS, file), 'utf8'));
  for (const record of contract.endpoints) {
    const reasons = record.reasons ?? [];
    const superseded = reasons.includes('superseded');
    const duplicate = reasons.some((r) => r.startsWith('duplicate-of'));
    const legacy = reasons.includes('legacy-v1');
    const noMethod = !record.method;
    // A GET legitimately has no body; only a body method (or an unknown one with an empty cell)
    // counts as a missing payload.
    const noRequest =
      !record.requestExample &&
      (BODY_METHODS.has(record.method) || (noMethod && !(record.requestRaw || '').trim()));
    const noResponse = !record.responseExample;
    const unparseable = reasons.filter((r) => r.endsWith('-unparseable'));

    let priority;
    let action;
    if (superseded) {
      priority = 'P5';
      action = 'None — retired (yellow). Confirm it can stay out of scope.';
    } else if (noMethod) {
      priority = 'P1';
      action = 'Add the HTTP method (GET/POST/PUT/DELETE) for this row.';
    } else if (duplicate || legacy) {
      priority = 'P4';
      action = duplicate
        ? `Confirm which row is current (${reasons.find((r) => r.startsWith('duplicate-of'))}).`
        : 'Confirm the v1 row is retired now that a /v2 row exists.';
    } else if (unparseable.length) {
      priority = 'P3';
      action = `Fix the JSON — prose is mixed into it (${unparseable.join(', ')}).`;
    } else if (noResponse && noRequest) {
      priority = 'P2';
      action = 'Add the request payload and a sample response.';
    } else if (noResponse) {
      priority = 'P2';
      action = 'Add a sample response.';
    } else if (noRequest) {
      priority = 'P2';
      action = 'Add the request payload.';
    } else {
      continue; // complete: nothing to fill
    }

    rows.push({
      Priority: priority,
      Product: record.product,
      Tab: record.tab,
      Row: record.row,
      Module: record.module ?? '',
      Endpoint: record.name ?? '',
      Path: record.path,
      Method: record.method ?? '',
      SuggestedMethod: noMethod ? suggestMethod(record) : '',
      HasRequest: record.requestExample ? 'yes' : record.requestRaw ? 'text only' : 'no',
      HasResponse: record.responseExample ? 'yes' : record.responseRaw ? 'text only' : 'no',
      Action: action,
    });
  }
}

const ORDER = { P1: 1, P2: 2, P3: 3, P4: 4, P5: 5 };
rows.sort(
  (a, b) =>
    ORDER[a.Priority] - ORDER[b.Priority] ||
    a.Product.localeCompare(b.Product) ||
    a.Tab.localeCompare(b.Tab) ||
    a.Row - b.Row,
);

/* ------------------------------------------------------------------ CSV */

const COLUMNS = [
  'Priority',
  'Product',
  'Tab',
  'Row',
  'Module',
  'Endpoint',
  'Path',
  'Method',
  'SuggestedMethod',
  'HasRequest',
  'HasResponse',
  'Action',
];
const cell = (value) => {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
// The byte-order mark is what makes Excel read the file as UTF-8 (module names contain arrows
// and dashes). Written as an escape so the source carries no invisible character.
const BOM = '﻿';
const csv =
  BOM +
  [COLUMNS.join(','), ...rows.map((r) => COLUMNS.map((c) => cell(r[c])).join(','))].join('\r\n') +
  '\r\n';
fs.writeFileSync(path.join(CONTRACTS, 'excel-gaps.csv'), csv);

/* ------------------------------------------------------------------ Markdown */

const count = (predicate) => rows.filter(predicate).length;
const byPriority = ['P1', 'P2', 'P3', 'P4', 'P5'].map((p) => [p, count((r) => r.Priority === p)]);
const byModule = {};
for (const r of rows.filter((x) => x.Priority === 'P1')) {
  const key = `${r.Product} · ${r.Module || '(no module)'}`;
  byModule[key] = (byModule[key] ?? 0) + 1;
}

const SAMPLE = 15;
const md = [
  '# Excel gaps — what to fill in the workbook',
  '',
  `Generated from the parsed contracts. ${rows.length} rows need something; open`,
  '`contracts/excel-gaps.csv` in Excel for the full list (it has Tab + Row to find each cell).',
  '',
  '| Priority | Meaning | Rows |',
  '| --- | --- | ---: |',
  `| P1 | **HTTP method missing** — blocks the endpoint entirely | ${byPriority[0][1]} |`,
  `| P2 | Request payload and/or sample response missing | ${byPriority[1][1]} |`,
  `| P3 | JSON cell has prose mixed in, so it cannot be parsed | ${byPriority[2][1]} |`,
  `| P4 | Duplicate or legacy row — confirm which is current | ${byPriority[3][1]} |`,
  `| P5 | Retired (yellow) — confirm out of scope | ${byPriority[4][1]} |`,
  '',
  '## P1 — missing HTTP method, by module',
  '',
  '| Module | Rows |',
  '| --- | ---: |',
  ...Object.entries(byModule)
    .sort((a, b) => b[1] - a[1])
    .map(([module, n]) => `| ${module} | ${n} |`),
  '',
  'The CSV has a `SuggestedMethod` column (`GET?` / `POST?`) guessed from the endpoint name to speed',
  'this up. **It is a hint — confirm each one.** The converter never reads it.',
  '',
  `## First ${SAMPLE} rows of each priority`,
  '',
];
for (const [priority] of byPriority) {
  const sample = rows.filter((r) => r.Priority === priority).slice(0, SAMPLE);
  if (!sample.length) continue;
  md.push(
    `### ${priority} (${count((r) => r.Priority === priority)} rows)`,
    '',
    '| Tab:Row | Path | Endpoint | Has req / res | Suggested | Action |',
    '| --- | --- | --- | --- | --- | --- |',
    ...sample.map(
      (r) =>
        `| ${r.Tab}:R${r.Row} | \`${r.Path}\` | ${r.Endpoint || '—'} | ${r.HasRequest} / ${r.HasResponse} | ${r.SuggestedMethod || '—'} | ${r.Action} |`,
    ),
    '',
  );
}
md.push(
  '## Gaps that are not per-row',
  '',
  '- **No HTTP status codes anywhere.** Nothing says 200 vs 201, and there are no error rows',
  '  (400/401/403/404/409/422). A "Success status" column and a few error samples would let the',
  '  bench assert status instead of assuming it.',
  '- **No auth flag.** Nothing marks an endpoint public vs token-required, or which user type may',
  '  call it. KMail’s "After Token Implemented" column is the only hint.',
  '- **Path/query parameters undocumented.** Templated URLs (e.g. `/v2/katchup/download/{uuid}`)',
  '  have no parameter table, and query strings are not documented at all.',
  '- **Admin module is absent from the workbook entirely** — it has no contract at all.',
  '- **`userType` has labels but no numbers** (`BUSINESS_S/M/L`), unlike every other type group.',
  '',
);
fs.writeFileSync(path.join(CONTRACTS, 'excel-gaps.md'), `${md.join('\n')}\n`);

/* ------------------------------------------------------------------ console */

console.log(`rows needing data: ${rows.length}\n`);
for (const [priority, n] of byPriority) console.log(`  ${priority}  ${String(n).padStart(4)}`);
console.log('\nby product:');
for (const product of ['kpost-api', 'kmail-api']) {
  console.log(`  ${product.padEnd(12)} ${count((r) => r.Product === product)}`);
}
console.log('\nwritten: contracts/excel-gaps.csv (open in Excel), contracts/excel-gaps.md');
