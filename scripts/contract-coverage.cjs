#!/usr/bin/env node
/**
 * Proves that every endpoint in the workbook reached our contracts.
 *
 *   npm run contract:coverage [-- "<workbook.xlsx>"]
 *
 * This deliberately re-parses the .xlsx **independently of the converter** and scans EVERY cell of
 * every endpoint tab for a URL — not just the columns the converter is configured to read. An
 * audit that reuses the converter's own column map would only ever agree with itself; this one can
 * catch a row whose URL sits in an unexpected column (KatchupAPI R66 has junk in K and the real
 * URL in A), which would otherwise be dropped silently.
 *
 * Writes contracts/_coverage.json and exits non-zero when anything in the workbook is missing from
 * the contracts, so it can act as a gate.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CONTRACTS = path.join(ROOT, 'contracts');
/*
 * By default this audits the very workbook the contracts were built from, read out of the
 * conversion report. Auditing a different file would compare two unrelated things and report
 * either phantom misses or a false all-clear.
 */
const reportFile = path.join(CONTRACTS, '_conversion-report.json');
const report = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) : {};
const SOURCE = process.argv[2] || process.env.KPOST_WORKBOOK || report.sourcePath;

if (!SOURCE || !fs.existsSync(SOURCE)) {
  console.error(
    SOURCE
      ? `workbook not found: ${SOURCE}`
      : 'no workbook recorded — run "npm run contract:excel" first, or pass the .xlsx path',
  );
  process.exit(2);
}
if (report.source && path.basename(SOURCE) !== report.source) {
  console.error(
    `refusing to audit: the contracts were built from "${report.source}" but this run was given ` +
      `"${path.basename(SOURCE)}". Re-run "npm run contract:excel" first, or audit the same file.`,
  );
  process.exit(3);
}

/* ------------------------------------------------------------------ read the workbook */

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kpost-coverage-'));
const zip = path.join(TMP, 'workbook.zip');
fs.copyFileSync(SOURCE, zip);
execFileSync('powershell', [
  '-NoProfile',
  '-Command',
  `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${TMP}' -Force`,
]);

const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');
const decode = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#10;/g, '\n')
    .replace(/&#13;/g, '')
    .replace(/&amp;/g, '&');
const textOf = (xml) =>
  [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join('');

const shared = [
  ...read(path.join(TMP, 'xl', 'sharedStrings.xml')).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g),
].map((m) => textOf(m[1]));

const rels = {};
for (const m of read(path.join(TMP, 'xl', '_rels', 'workbook.xml.rels')).matchAll(
  /Id="([^"]+)"[^>]*Target="([^"]+)"/g,
)) {
  rels[m[1]] = m[2];
}
const sheets = [
  ...read(path.join(TMP, 'xl', 'workbook.xml')).matchAll(
    /<sheet\b[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g,
  ),
].map((m) => ({ name: decode(m[1]), target: rels[m[2]] }));

function rowsOf(sheetName) {
  const sheet = sheets.find((s) => s.name === sheetName);
  if (!sheet) return [];
  const xml = read(path.join(TMP, 'xl', String(sheet.target).replace(/^\/?xl\//, '')));
  const rows = [];
  for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rowNum = Number(/r="(\d+)"/.exec(rowMatch[1])?.[1] ?? 0);
    const cells = {};
    for (const c of rowMatch[2].matchAll(/<c\b([^>]*?)\/>|<c\b([^>]*?)>([\s\S]*?)<\/c>/g)) {
      const attrs = c[1] ?? c[2] ?? '';
      const inner = c[3] ?? '';
      const col = /r="([A-Z]+)\d+"/.exec(attrs)?.[1];
      if (!col) continue;
      const type = /t="([^"]+)"/.exec(attrs)?.[1];
      const raw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let value = '';
      if (type === 's' && raw !== undefined) value = shared[Number(raw)] ?? '';
      else if (type === 'inlineStr' || inner.includes('<t')) value = textOf(inner);
      else if (raw !== undefined) value = decode(raw);
      if (String(value).trim()) cells[col] = String(value);
    }
    if (Object.keys(cells).length) rows.push({ row: rowNum, cells });
  }
  return rows;
}

/* ------------------------------------------------------------------ every URL in the workbook */

/** Tabs that document endpoints. Types/Sheet8 are reference tables, "Kool Kall" is empty in v5. */
const ENDPOINT_TABS = {
  KatchupAPI: 'kpost-api',
  KDIARY: 'kpost-api',
  'V2 TESTED APIS': 'kpost-api',
  Sheet3: 'kpost-api',
  KMAILAPI: 'kmail-api',
};

/** Normalised so "https://host/v2/x/", "/v2/x" and "v2/x/" compare equal. */
const normalise = (url) =>
  `/${String(url)
    .trim()
    .replace(/^https?:\/\/[^/]+/, '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/{2,}/g, '/')}`.toLowerCase();

const URL_IN_TEXT = /https?:\/\/[^\s"'<>()]+/g;

const workbookEndpoints = [];
for (const [tab, product] of Object.entries(ENDPOINT_TABS)) {
  for (const { row, cells } of rowsOf(tab)) {
    const found = new Set();
    for (const [col, value] of Object.entries(cells)) {
      // Absolute URLs anywhere in the row…
      for (const match of String(value).matchAll(URL_IN_TEXT)) {
        const p = normalise(match[0]);
        if (/^\/[a-z]/i.test(p)) found.add(`${p}|${col}`);
      }
      // …plus bare paths in a URL column of the tabs that use them (KMail/KDiary).
      if (
        ['C', 'D'].includes(col) &&
        /^\/?[a-zA-Z][\w-]*\//.test(value.trim()) &&
        !/\s/.test(value.trim())
      ) {
        found.add(`${normalise(value)}|${col}`);
      }
    }
    for (const entry of found) {
      const [p, col] = entry.split('|');
      workbookEndpoints.push({ product, tab, row, column: col, path: p });
    }
  }
}

/* ------------------------------------------------------------------ what the contracts hold */

const contractPaths = new Map();
/** Old URL -> the row that says it changed. */
const replacedPaths = new Map();
for (const file of ['kpost-api.contract.json', 'kmail-api.contract.json']) {
  const full = path.join(CONTRACTS, file);
  if (!fs.existsSync(full)) {
    console.error(`missing ${file} — run "npm run contract:excel" first`);
    process.exit(2);
  }
  for (const record of JSON.parse(fs.readFileSync(full, 'utf8')).endpoints) {
    const key = `${record.product}${normalise(record.path)}`;
    contractPaths.set(key, [...(contractPaths.get(key) ?? []), `${record.tab}:R${record.row}`]);
    /*
     * "endKall url changed to endKoolKall" documents ONE endpoint that moved. The old URL is
     * deliberately not a contract entry, so record why - otherwise this audit either fails on a
     * correct decision or, worse, waves it through under the wrong explanation.
     */
    if (record.replacedUrl) {
      replacedPaths.set(
        `${record.product}${normalise(record.replacedUrl)}`,
        `${record.tab}:R${record.row}`,
      );
    }
  }
}

/**
 * A URL in a notes column is a MENTION, not an endpoint of that row: the Katchup tab's column A
 * quotes old v1 names and review comments, and KMAILAPI R1 holds the tab's base URL. Only a row
 * whose own endpoint column is empty or junk can hide a real endpoint, so only those are failures.
 */
const ENDPOINT_COLUMN = {
  KatchupAPI: 'K',
  KMAILAPI: 'D',
  KDIARY: 'D',
  'V2 TESTED APIS': 'C',
  Sheet3: 'C',
};
const rowCache = {};
const rowCells = (tab, row) => {
  rowCache[tab] ??= rowsOf(tab);
  return rowCache[tab].find((r) => r.row === row)?.cells ?? {};
};

const uncovered = [];
const mentions = [];
for (const entry of workbookEndpoints) {
  const key = `${entry.product}${entry.path}`;
  if (contractPaths.has(key)) continue;
  // A path ending in a version segment is a base URL (KMAILAPI R1 = "/kmail5/v2"), not an
  // endpoint. Genuine two-segment KMail paths like /common/getSaluations are unaffected.
  if (/\/v\d+$/.test(entry.path)) {
    mentions.push({ ...entry, note: 'base URL, not an endpoint' });
    continue;
  }
  const replacedBy = replacedPaths.get(key);
  if (replacedBy) {
    mentions.push({
      ...entry,
      note: `superseded in-row ("url changed to"), current URL from ${replacedBy}`,
    });
    continue;
  }
  const endpointColumn = ENDPOINT_COLUMN[entry.tab];
  const own = (rowCells(entry.tab, entry.row)[endpointColumn] ?? '').trim();
  const rowHasItsOwnEndpoint = /^https?:\/\//.test(own) || /^\/?[a-zA-Z][\w-]*\//.test(own);
  // Say which it is: a note-column quote and a second URL sitting in the endpoint column itself
  // are different situations, and calling both "notes" hid a real drop once already.
  if (rowHasItsOwnEndpoint) {
    mentions.push({
      ...entry,
      note:
        entry.column === endpointColumn
          ? "listed in the endpoint column beside the row's other endpoint"
          : 'quoted in a notes column',
    });
  } else uncovered.push(entry);
}

/* ------------------------------------------------------------------ report */

const byTab = {};
for (const entry of workbookEndpoints) {
  byTab[entry.tab] ??= { workbookPaths: new Set(), uncovered: 0 };
  byTab[entry.tab].workbookPaths.add(entry.path);
}
for (const entry of uncovered) byTab[entry.tab].uncovered += 1;

const summary = Object.fromEntries(
  Object.entries(byTab).map(([tab, v]) => [
    tab,
    { distinctPathsInWorkbook: v.workbookPaths.size, uncoveredMentions: v.uncovered },
  ]),
);

fs.writeFileSync(
  path.join(CONTRACTS, '_coverage.json'),
  `${JSON.stringify(
    {
      source: path.basename(SOURCE),
      generatedAt: new Date().toISOString(),
      contractPaths: contractPaths.size,
      workbookMentions: workbookEndpoints.length,
      summary,
      uncovered,
      mentionsOnly: mentions,
    },
    null,
    2,
  )}\n`,
);

console.log(`workbook URL mentions scanned : ${workbookEndpoints.length}`);
console.log(`distinct paths in contracts   : ${contractPaths.size}`);
for (const [tab, v] of Object.entries(summary)) {
  console.log(
    `  ${tab.padEnd(16)} workbookPaths=${String(v.distinctPathsInWorkbook).padStart(4)}  uncovered=${v.uncoveredMentions}`,
  );
}
if (uncovered.length) {
  console.log(`\nNOT in the contracts (${uncovered.length}):`);
  for (const entry of uncovered.slice(0, 25)) {
    console.log(`  ${entry.tab}:R${entry.row} [${entry.column}] ${entry.path}`);
  }
  if (uncovered.length > 25)
    console.log(`  … and ${uncovered.length - 25} more (see contracts/_coverage.json)`);
} else {
  console.log('\nEvery endpoint URL in the workbook is present in the contracts.');
}
process.exitCode = uncovered.length ? 1 : 0;
