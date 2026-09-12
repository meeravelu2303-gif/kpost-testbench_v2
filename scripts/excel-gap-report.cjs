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
 * ## What this list is for
 *
 * Every row here is something only the API owner can settle. The two kinds are different:
 *
 *   NeedsConfirming=yes   the method was DERIVED (payload -> POST, none -> GET) and could be wrong,
 *                         or the workbook contradicts itself. Confirm or correct it.
 *   otherwise             data is genuinely missing: a payload, a sample response, or valid JSON.
 *
 * The `FillCell` column names the exact cell a correction goes in, taken from the conversion
 * report so this list and the parser can never disagree about where the method lives.
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

/*
 * Where each tab's HTTP method goes. Taken from the conversion report so there is ONE source of
 * truth: the converter finds the Method column by header, and reports the first free column for
 * the tabs that have no Method column yet (KatchupAPI, Sheet3). Filling that column needs no code
 * change - append it, never insert it, or every other column letter shifts.
 */
const reportPath = path.join(CONTRACTS, '_conversion-report.json');
const tabLayouts = fs.existsSync(reportPath)
  ? (JSON.parse(fs.readFileSync(reportPath, 'utf8')).tabs ?? [])
  : [];
const methodCellColumn = new Map(
  tabLayouts.map((t) => [t.sheet, t.methodColumn ?? t.firstFreeColumn]),
);
const newMethodColumnTabs = tabLayouts.filter((t) => !t.methodColumn);

/** e.g. "KatchupAPI!Q7" - the cell to type the method into. */
function methodCell(tab, row) {
  const column = methodCellColumn.get(tab);
  return column ? `${tab}!${column}${row}` : '';
}

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

/** How the request cell reads, in the CSV's words. */
const REQUEST_LABEL = {
  json: 'payload',
  multipart: 'file upload',
  unparseable: 'payload (sample broken)',
  none: 'no payload',
  unclear: 'unclear',
};

const rows = [];
const overrides = [];
let retiredCount = 0;
for (const file of files) {
  const contract = JSON.parse(fs.readFileSync(path.join(CONTRACTS, file), 'utf8'));
  for (const record of contract.endpoints) {
    const reasons = record.reasons ?? [];
    const superseded = reasons.includes('superseded');
    const duplicate = reasons.some((r) => r.startsWith('duplicate-of'));
    const legacy = reasons.includes('legacy-v1');
    const doubts = record.methodDoubts ?? [];
    if (record.methodNote) {
      overrides.push({ ...record, cell: methodCell(record.tab, record.row) });
    }
    const derived = record.methodSource === 'payload-rule';
    const conflict = doubts.some((d) => d.startsWith('method-conflict'));
    /*
     * A GET legitimately has no body, so "no payload documented" is only a gap when the method
     * the workbook itself states takes one. Under the payload rule a POST always has a payload by
     * definition, so this now catches exactly the real contradiction: the Method column says POST
     * (or PUT/PATCH) while the request cell documents nothing.
     */
    const noRequest =
      !record.requestExample && BODY_METHODS.has(record.method) && record.requestKind === 'none';
    const brokenRequest = record.requestKind === 'unparseable';
    const noResponse = !record.responseExample;
    const brokenResponse = reasons.includes('response-unparseable');

    let priority;
    let action;
    /*
     * Retired rows are settled, not gaps. The owner has confirmed that a yellow row is an unused
     * endpoint and is not to be added, so listing 24 of them as "confirm out of scope" was asking
     * a question that already has an answer. They are counted in the summary instead.
     */
    if (superseded || reasons.includes('unused-note')) {
      retiredCount += 1;
      continue;
    }
    if (conflict) {
      priority = 'P1';
      action = `Resolve the method conflict: ${doubts.find((d) => d.startsWith('method-conflict'))}.`;
    } else if (derived && doubts.length) {
      priority = 'P1';
      action = `Confirm the method (${record.method}, derived): ${doubts.join('; ')}.`;
    } else if (duplicate || legacy) {
      priority = 'P4';
      action = duplicate
        ? `Confirm which row is current (${reasons.find((r) => r.startsWith('duplicate-of'))}).`
        : 'Confirm the v1 row is retired now that a /v2 row exists.';
    } else if (record.dataNotes) {
      priority = 'P4';
      action = `${record.dataNotes.join('; ')} — split the row so each endpoint has its own payload.`;
    } else if (brokenRequest || brokenResponse) {
      priority = 'P3';
      const which = [brokenRequest && 'request', brokenResponse && 'response'].filter(Boolean);
      action =
        `Fix the ${which.join(' and ')} sample — it is not valid JSON ` +
        '(prose or `0 or 1 or 2` style alternatives mixed in), so no schema can be inferred.';
    } else if (noResponse && noRequest) {
      priority = 'P2';
      action = `Add the request payload (the method column says ${record.method}) and a sample response.`;
    } else if (noResponse) {
      priority = 'P2';
      action = 'Add a sample response.';
    } else if (noRequest) {
      priority = 'P2';
      action = `Add the request payload — the method column says ${record.method}, which takes one.`;
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
      MethodFrom: record.methodSource ?? '',
      NeedsConfirming: doubts.length ? 'yes' : '',
      FillCell: derived || doubts.length ? methodCell(record.tab, record.row) : '',
      Request: REQUEST_LABEL[record.requestKind] ?? '',
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
  'MethodFrom',
  'NeedsConfirming',
  'FillCell',
  'Request',
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
/**
 * Excel keeps an exclusive lock on an open file, so a regenerate while the list is open cannot
 * overwrite it. Failing outright would leave the reader with a stale list and no new one, so the
 * fresh copy is written alongside as `<name>.new.<ext>` and called out at the end.
 */
const lockedWrites = [];
function write(file, contents) {
  try {
    fs.writeFileSync(path.join(CONTRACTS, file), contents);
  } catch (error) {
    if (error.code !== 'EBUSY' && error.code !== 'EPERM') throw error;
    const alternative = file.replace(/(.[^.]+)$/, '.new$1');
    fs.writeFileSync(path.join(CONTRACTS, alternative), contents);
    lockedWrites.push({ file, alternative });
  }
}
write('excel-gaps.csv', csv);

/* ------------------------------------------------------------------ Markdown */

const count = (predicate) => rows.filter(predicate).length;
const byPriority = ['P1', 'P2', 'P3', 'P4', 'P5'].map((p) => [p, count((r) => r.Priority === p)]);
const byModule = {};
const byTab = {};
for (const r of rows.filter((x) => x.Priority === 'P1')) {
  const key = `${r.Product} · ${r.Module || '(no module)'}`;
  byModule[key] = (byModule[key] ?? 0) + 1;
  byTab[r.Tab] = (byTab[r.Tab] ?? 0) + 1;
}

/*
 * A few workbook rows document TWO endpoints in one row (the URL cell holds both). One Method
 * cell cannot then say which verb belongs to which endpoint, so those rows have to be split
 * before the method can be recorded. Worth naming explicitly - it is invisible in the CSV,
 * where the two endpoints look like duplicate FillCell values.
 */
/** A markdown code span. */
const code = (value) => '`' + value + '`';
const cellPaths = {};
for (const r of rows.filter((x) => x.Priority === 'P1' && x.FillCell)) {
  (cellPaths[r.FillCell] ??= new Set()).add(r.Path);
}
const sharedCells = Object.entries(cellPaths).filter(([, paths]) => paths.size > 1);
const SAMPLE = 15;
const md = [
  '# Excel gaps — what to confirm or fill in the workbook',
  '',
  `Generated from the parsed contracts. ${rows.length} rows need attention; open`,
  '`contracts/excel-gaps.csv` in Excel for the full list — it has **Tab**, **Row** and **FillCell**,',
  'so every line names the cell it is talking about.',
  '',
  '## How the HTTP method is decided now',
  '',
  'Methods are no longer blocked on the workbook. The rule given by the API owner is applied:',
  '',
  '> **A documented request payload means POST. No payload means GET.**',
  '',
  'This API uses **only POST and GET** — no PUT, PATCH or DELETE (the workbook states a method 95',
  'times: 80 POST, 15 GET). So an `updateX` or `deleteX` endpoint with a payload is a POST, and the',
  'rule needs no confirming.',
  '',
  'The workbook still wins wherever it states a method — a Method column, or a `GET METHOD` note in',
  'the request cell — and the **MethodFrom** column records which applied:',
  '',
  '| MethodFrom | Meaning |',
  '| --- | --- |',
  '| `method-column` | the tab has a Method column and it was used |',
  '| `request-note` | the request cell says so in words (`GET METHOD`, `Not Required(Get method)`) |',
  '| `payload-rule` | derived from the presence of a payload, per the rule above |',
  '',
  'Typing a method into the **FillCell** cell overrides the derived one on the next run.',
  '',
  `**Yellow rows are unused and are not added** — ${retiredCount} of them, excluded and not listed`,
  'below. They stay in `*.contract.json` marked `usable: false` so the decision is auditable.',
  '',
  '| Priority | Meaning | Rows |',
  '| --- | --- | ---: |',
  `| P1 | **Confirm the HTTP method** — the workbook contradicts itself | ${byPriority[0][1]} |`,
  `| P2 | Request payload and/or sample response missing | ${byPriority[1][1]} |`,
  `| P3 | The JSON sample does not parse, so no schema is inferred | ${byPriority[2][1]} |`,
  `| P4 | Duplicate, legacy, or two endpoints in one row | ${byPriority[3][1]} |`,
  '',
  ...(overrides.length
    ? [
        `## Resolved without you: ${overrides.length} rows where the request cell won`,
        '',
        'These are **not** gaps. The Method column disagreed with the request cell, and the cell',
        'agreed with the payload, so the cell was used — the column predates tokens, the cell',
        "describes today's contract:",
        '',
        '| Cell | Endpoint | Method used | Column said |',
        '| --- | --- | --- | --- |',
        ...overrides.map(
          (o) => `| ${code(o.cell)} | ${code(o.path)} | **${o.method}** | ${o.methodOverrode} |`,
        ),
        '',
      ]
    : []),
  ...(byPriority[0][1]
    ? ['## P1 — methods to confirm, by module', '']
    : [
        '## P1 — nothing to confirm',
        '',
        'Every method is either stated by the workbook or settled',
        'by the payload rule.',
        '',
      ]),
  ...(byPriority[0][1] ? ['| Module | Rows |', '| --- | ---: |'] : []),
  ...Object.entries(byModule)
    .sort((a, b) => b[1] - a[1])
    .map(([module, n]) => `| ${module} | ${n} |`),
  '',
  '### Where to type a correction',
  '',
  'Only needed where the derived method is wrong. Per tab:',
  '',
  '| Tab | P1 rows | Method column | Status |',
  '| --- | ---: | --- | --- |',
  ...tabLayouts.map(
    (t) =>
      `| ${t.sheet} | ${byTab[t.sheet] ?? 0} | **${t.methodColumn ?? t.firstFreeColumn}** | ${
        t.methodColumn
          ? 'already there'
          : `none — a column headed \`Method\` in ${t.firstFreeColumn} would override the derived methods`
      } |`,
  ),
  '',
  ...(newMethodColumnTabs.length
    ? [
        `> **If you add that column (${newMethodColumnTabs
          .map((t) => `${t.sheet} → ${t.firstFreeColumn}`)
          .join(', ')}), append it at the end — never insert it.**`,
        '> The converter finds the Method column by its header, so appending it needs no code change.',
        '> Inserting one shifts every column letter after it — the converter then stops with a',
        '> "layout changed" error instead of reading the wrong cells.',
        '',
      ]
    : []),
  ...(sharedCells.length
    ? [
        `**${sharedCells.length} rows document two endpoints each.** The single payload is applied to`,
        'both and flagged; splitting them into one row per endpoint removes the ambiguity:',
        '',
        ...sharedCells.map(([cell, paths]) => '- ' + code(cell) + ' — ' + [...paths].join('  |  ')),
        '',
      ]
    : []),
  `## First ${SAMPLE} rows of each priority`,
  '',
];
for (const [priority] of byPriority) {
  const sample = rows.filter((r) => r.Priority === priority).slice(0, SAMPLE);
  if (!sample.length) continue;
  md.push(
    `### ${priority} (${count((r) => r.Priority === priority)} rows)`,
    '',
    '| Tab:Row | Path | Method | From | Request / Response | Action |',
    '| --- | --- | --- | --- | --- | --- |',
    ...sample.map(
      (r) =>
        `| ${r.Tab}:R${r.Row} | ${code(r.Path)} | ${r.Method || '—'} | ${r.MethodFrom || '—'} | ${r.Request} / ${r.HasResponse} | ${r.Action} |`,
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
write('excel-gaps.md', `${md.join('\n')}\n`);

/* ------------------------------------------------------------------ console */

console.log(`rows needing data: ${rows.length}\n`);
for (const [priority, n] of byPriority) console.log(`  ${priority}  ${String(n).padStart(4)}`);
console.log('\nby product:');
for (const product of ['kpost-api', 'kmail-api']) {
  console.log(`  ${product.padEnd(12)} ${count((r) => r.Product === product)}`);
}
console.log('\nwritten: contracts/excel-gaps.csv, contracts/excel-gaps.md');

for (const { file, alternative } of lockedWrites) {
  console.log(
    `\ncontracts/${file} is open in Excel and could not be replaced — wrote contracts/${alternative} instead.` +
      `\nClose it and re-run to refresh the original, or just open the .new file.`,
  );
}
