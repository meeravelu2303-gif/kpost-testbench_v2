#!/usr/bin/env node
/**
 * Converts the "KPOST API" workbook into the contracts this bench tests against.
 *
 *   node scripts/excel-to-contract.cjs ["<workbook.xlsx>"]
 *
 * The workbook is the AUTHORITATIVE contract (the swagger files disagreed with it and were
 * removed). Two products are maintained by different teams, so they get separate outputs:
 *
 *   contracts/kpost-api.contract.json   KatchupAPI + KDIARY + V2 TESTED APIS + Sheet3
 *   contracts/kmail-api.contract.json   KMAILAPI
 *   contracts/kpost-types.json          the Types tab (enums shared by both)
 *   openapi/kpost-api.openapi.json      generated from the USABLE rows only
 *   openapi/kmail-api.openapi.json      "
 *   contracts/_conversion-report.json   every row that was excluded, and why
 *
 * ## What "usable" means — nothing invalid or duplicated is converted
 *
 * A row reaches the OpenAPI document only when it has a real path AND a known HTTP method AND is
 * not superseded and not a duplicate. Everything else stays in the .contract.json marked
 * `usable: false` with its reasons, so the gap is visible instead of guessed at:
 *
 *   - superseded        yellow (#FFFF00) fill = retired endpoint
 *   - method-unknown    no Method column and no method stated in the text (KatchupAPI mostly)
 *   - duplicate         same method+path already taken from a better row
 *   - legacy-v1         a devapi1/no-/v2 row whose /v2 twin exists
 *   - request/response-unparseable  the cell mixes prose into the JSON, so no schema is inferred
 *
 * Method is NEVER guessed from the presence of a body: a wrong verb produces failing tests that
 * blame the API for the spreadsheet. It is read from a Method column, or from an explicit
 * "GET METHOD"-style note in the row, or the row is excluded.
 *
 * Schemas are INFERRED FROM EXAMPLES, so no property is marked `required` — an example cannot
 * prove a field is mandatory. Types come from the sample values; the sample itself is kept as
 * `example` so a reader sees exactly what the workbook documented.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SOURCE =
  process.argv[2] ||
  process.env.KPOST_WORKBOOK ||
  'C:/Users/Administrator/Downloads/KPOST API (5).xlsx';

if (!fs.existsSync(SOURCE)) {
  console.error(`workbook not found: ${SOURCE}`);
  console.error('usage: node scripts/excel-to-contract.cjs "<path to KPOST API (N).xlsx>"');
  process.exit(2);
}

/* ------------------------------------------------------------------ workbook reading */

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kpost-xlsx-'));
const zip = path.join(TMP, 'workbook.zip'); // Expand-Archive insists on a .zip extension.
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

const stylesXml = read(path.join(TMP, 'xl', 'styles.xml'));
const fills = [
  ...(/<fills\b[^>]*>([\s\S]*?)<\/fills>/.exec(stylesXml)?.[1] ?? '').matchAll(
    /<fill>([\s\S]*?)<\/fill>/g,
  ),
].map((m) => /FFFF00/i.test(m[1]));
const xfFillIds = [
  ...(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? '').matchAll(
    /<xf\b([^>]*?)\/?>/g,
  ),
].map((m) => Number(/fillId="(\d+)"/.exec(m[1])?.[1] ?? 0));
/** Yellow fill = superseded. It lives in styles.xml, never on the cell itself. */
const isYellow = (styleIndex) => Boolean(fills[xfFillIds[Number(styleIndex) || 0]]);

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
    const yellow = {};
    // Self-closing cells need their own alternative FIRST, or a greedy pattern swallows
    // the following cells and every column after it shifts.
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
      if (!String(value).trim()) continue;
      cells[col] = String(value);
      if (isYellow(/s="(\d+)"/.exec(attrs)?.[1])) yellow[col] = true;
    }
    if (Object.keys(cells).length) rows.push({ row: rowNum, cells, yellow });
  }
  return rows;
}

/* ------------------------------------------------------------------ tab layouts */

/**
 * Verified against KPOST API (5).xlsx. The tabs do not share a shape and guessing costs
 * correctness: on KatchupAPI a "first URL-shaped cell" rule picks column A (free-text notes that
 * quote URLs), and the real response sample is in N ("Tester Response"), not M.
 */
const TABS = [
  {
    sheet: 'KatchupAPI',
    product: 'kpost-api',
    module: 'B',
    name: 'J',
    url: 'K',
    request: ['L'],
    response: ['N', 'M'],
    methodColumn: null,
  },
  {
    sheet: 'KDIARY',
    product: 'kpost-api',
    module: 'B',
    url: 'D',
    methodColumn: 'C',
    request: ['E'],
    response: ['F'],
  },
  {
    sheet: 'V2 TESTED APIS',
    product: 'kpost-api',
    url: 'C',
    methodColumn: 'B',
    request: ['D'],
    response: ['F'],
  },
  {
    sheet: 'Sheet3',
    product: 'kpost-api',
    url: 'C',
    methodColumn: null,
    request: ['D'],
    response: ['F'],
  },
  {
    sheet: 'KMAILAPI',
    product: 'kmail-api',
    module: 'B',
    url: 'D',
    methodColumn: 'C',
    // Later rows moved the current body into E (no before/after token split), so E is the
    // fallback whenever F is blank.
    request: ['F', 'E'],
    response: ['G'],
  },
];

const PRODUCTS = {
  'kpost-api': {
    title: 'KPost API',
    description:
      'KPost core API (katchup, kall, kdiary, knews, kword, admin-facing and common routes).',
    defaultServer: 'https://devapi2.kpostindia.com',
  },
  'kmail-api': {
    title: 'KMail API',
    description: 'KMail module API, maintained in its own repository.',
    defaultServer: 'https://kmail5.kpostindia.com/kmail5/v2',
  },
};

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const METHOD_IN_TEXT = new RegExp(`\\b(${METHODS.join('|')})\\b\\s*(METHOD|method)?`);

/* ------------------------------------------------------------------ cell helpers */

/** Top-level balanced {...} blocks, in order. A lazy regex stops at the first inner brace. */
function jsonBlocks(text) {
  const blocks = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        blocks.push(text.slice(start, i + 1));
        start = -1;
      }
      if (depth < 0) depth = 0;
    }
  }
  return blocks;
}

/**
 * Parses a documented body. Many cells mix prose into the JSON
 * (`"type": 1- Daily, 2 - Weekly`, `"userType":"PERSONAL" or "BUSINESS"`), so a light repair is
 * attempted; anything still unparseable is reported rather than guessed into a schema.
 */
function parseBody(text) {
  const block = jsonBlocks(text)[0];
  if (!block) return { ok: false, reason: text.trim() ? 'no JSON object in cell' : 'empty' };
  const attempts = [
    block,
    block
      .replace(/,\s*([}\]])/g, '$1') // trailing commas
      .replace(/\/\/[^\n"]*/g, '') // // comments
      .replace(/"\s+or\s+"/g, '", "') // "A" or "B"
      .replace(/:\s*"([^"]*)"\s+or\s+"([^"]*)"/g, ': "$1"'), // keep the first alternative
  ];
  for (const candidate of attempts) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === 'object') return { ok: true, value, raw: block };
    } catch {
      /* try the next repair */
    }
  }
  return { ok: false, reason: 'prose mixed into the JSON', raw: block };
}

/** JSON Schema from an example. No `required`: an example cannot prove a field is mandatory. */
function inferSchema(value) {
  if (Array.isArray(value)) {
    return { type: 'array', items: value.length ? inferSchema(value[0]) : {} };
  }
  if (value === null) return {};
  switch (typeof value) {
    case 'string':
      return { type: 'string' };
    case 'number':
      return { type: Number.isInteger(value) ? 'integer' : 'number' };
    case 'boolean':
      return { type: 'boolean' };
    case 'object':
      return {
        type: 'object',
        properties: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, inferSchema(v)])),
      };
    default:
      return {};
  }
}

const firstCell = (cells, columns) => {
  for (const col of columns ?? []) if ((cells[col] ?? '').trim()) return cells[col];
  return '';
};

const toPath = (url) => {
  let p = url.trim().replace(/^https?:\/\/[^/]+/, '');
  if (!p.startsWith('/')) p = `/${p}`;
  return p.replace(/\/{2,}/g, '/');
};

const operationIdFrom = (name, method, pathname) => {
  const fromName = (name || '').trim().split(/\s+/)[0];
  if (fromName && /^[A-Za-z][\w-]*$/.test(fromName)) return fromName;
  const segments = pathname.split('/').filter((s) => s && !s.startsWith('{'));
  const tail = segments.slice(-2).join('-') || 'root';
  return `${method.toLowerCase()}-${tail}`.replace(/[^\w-]/g, '');
};

/* ------------------------------------------------------------------ extraction */

const records = [];

for (const tab of TABS) {
  for (const { row, cells, yellow } of rowsOf(tab.sheet)) {
    const urlCell = (cells[tab.url] ?? '').trim();
    const urls = urlCell
      .split(/\s+/)
      .filter((u) => /^https?:\/\//.test(u) || /^\/?[a-zA-Z][\w-]*\//.test(u));
    if (!urls.length) continue;

    const requestText = firstCell(cells, tab.request);
    const responseText = firstCell(cells, tab.response);
    const explicitMethod = (cells[tab.methodColumn] ?? '').trim().toUpperCase();
    const textMethod = METHOD_IN_TEXT.exec(requestText)?.[1]?.toUpperCase() ?? '';
    const method = METHODS.includes(explicitMethod)
      ? explicitMethod
      : METHODS.includes(textMethod)
        ? textMethod
        : null;

    // A row documenting two endpoints pairs its URLs with its {...} blocks positionally.
    const bodies = jsonBlocks(requestText);
    for (const [index, url] of urls.entries()) {
      const pathname = toPath(url);
      if (!/^\/[a-zA-Z]/.test(pathname)) continue;

      const ownRequestText =
        urls.length === 1 ? requestText : bodies.length === urls.length ? bodies[index] : '';
      const request = parseBody(ownRequestText);
      const response = parseBody(responseText);
      const reasons = [];
      if (yellow[tab.url] || yellow[tab.module]) reasons.push('superseded');
      if (!method) reasons.push('method-unknown');
      if (!request.ok && request.reason === 'prose mixed into the JSON')
        reasons.push('request-unparseable');
      if (!response.ok && response.reason === 'prose mixed into the JSON')
        reasons.push('response-unparseable');

      records.push({
        product: tab.product,
        tab: tab.sheet,
        row,
        module: (cells[tab.module] ?? '').trim() || undefined,
        name: (cells[tab.name] ?? '').trim().split(/\s+/)[index] || undefined,
        method,
        path: pathname,
        sourceUrl: url,
        legacy:
          /devapi1/.test(url) || (!pathname.startsWith('/v2/') && tab.product === 'kpost-api'),
        requestExample: request.ok ? request.value : undefined,
        requestRaw: (request.raw ?? ownRequestText).trim() || undefined,
        responseExample: response.ok ? response.value : undefined,
        responseRaw: (response.raw ?? responseText).trim() || undefined,
        reasons,
      });
    }
  }
}

/* ------------------------------------------------------------------ validity + dedupe */

const excluded = [];
const byProduct = {};

for (const product of Object.keys(PRODUCTS)) {
  const mine = records.filter((r) => r.product === product);

  // A /v2 twin retires its legacy sibling rather than both being converted.
  const modernPaths = new Set(
    mine.filter((r) => !r.legacy).map((r) => r.path.replace(/^\/v2/, '')),
  );
  for (const record of mine) {
    if (
      record.legacy &&
      modernPaths.has(record.path.replace(/^\/v2/, '')) &&
      !record.reasons.includes('legacy-v1')
    ) {
      record.reasons.push('legacy-v1');
    }
  }

  /** Completeness decides which duplicate survives; ties keep the earliest row. */
  const score = (r) =>
    (r.requestExample ? 2 : 0) + (r.responseExample ? 2 : 0) + (r.legacy ? -1 : 0);
  const best = new Map();
  for (const record of mine) {
    if (!record.method) continue;
    const key = `${record.method} ${record.path.replace(/\/+$/, '')}`;
    const incumbent = best.get(key);
    if (!incumbent || score(record) > score(incumbent)) {
      if (incumbent) incumbent.reasons.push(`duplicate-of ${incumbent.tab}:R${record.row}`);
      best.set(key, record);
    } else {
      record.reasons.push(`duplicate-of ${incumbent.tab}:R${incumbent.row}`);
    }
  }

  const blocking = new Set(['superseded', 'method-unknown', 'legacy-v1']);
  for (const record of mine) {
    record.usable =
      !record.reasons.some((r) => blocking.has(r) || r.startsWith('duplicate-of')) &&
      Boolean(record.method);
    if (!record.usable)
      excluded.push({
        product,
        tab: record.tab,
        row: record.row,
        path: record.path,
        reasons: record.reasons,
      });
  }
  byProduct[product] = mine;
}

/* ------------------------------------------------------------------ outputs */

const contractsDir = path.join(ROOT, 'contracts');
const openapiDir = path.join(ROOT, 'openapi');
fs.mkdirSync(contractsDir, { recursive: true });
fs.mkdirSync(openapiDir, { recursive: true });

const workbookName = path.basename(SOURCE);
const generatedAt = new Date().toISOString();
const summary = {};

for (const [product, meta] of Object.entries(PRODUCTS)) {
  const mine = byProduct[product] ?? [];
  const usable = mine
    .filter((r) => r.usable)
    .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

  fs.writeFileSync(
    path.join(contractsDir, `${product}.contract.json`),
    `${JSON.stringify(
      {
        source: workbookName,
        product: meta.title,
        generatedAt,
        counts: {
          rows: mine.length,
          usable: usable.length,
          excluded: mine.length - usable.length,
          withRequestExample: mine.filter((r) => r.requestExample).length,
          withResponseExample: mine.filter((r) => r.responseExample).length,
        },
        endpoints: mine.sort((a, b) => a.tab.localeCompare(b.tab) || a.row - b.row),
      },
      null,
      2,
    )}\n`,
  );

  const paths = {};
  const usedOperationIds = new Set();
  for (const record of usable) {
    const operation = {
      operationId: (() => {
        let id = operationIdFrom(record.name, record.method, record.path);
        while (usedOperationIds.has(id)) id = `${id}-${record.row}`;
        usedOperationIds.add(id);
        return id;
      })(),
      summary: record.name || `${record.method} ${record.path}`,
      tags: record.module ? [record.module] : undefined,
      'x-excel-source': `${record.tab}:R${record.row}`,
      parameters: [...record.path.matchAll(/\{(\w+)}/g)].map((m) => ({
        name: m[1],
        in: 'path',
        required: true,
        schema: { type: 'string' },
      })),
      responses: record.responseExample
        ? {
            200: {
              description: 'Documented sample response',
              content: {
                'application/json': {
                  schema: inferSchema(record.responseExample),
                  example: record.responseExample,
                },
              },
            },
          }
        : { 200: { description: 'No response documented in the workbook' } },
    };
    if (record.requestExample && record.method !== 'GET') {
      operation.requestBody = {
        content: {
          'application/json': {
            schema: inferSchema(record.requestExample),
            example: record.requestExample,
          },
        },
      };
    }
    if (!operation.parameters.length) delete operation.parameters;
    if (!operation.tags) delete operation.tags;

    paths[record.path] ??= {};
    paths[record.path][record.method.toLowerCase()] = operation;
  }

  fs.writeFileSync(
    path.join(openapiDir, `${product}.openapi.json`),
    `${JSON.stringify(
      {
        openapi: '3.1.0',
        info: {
          title: meta.title,
          version: workbookName,
          description:
            `${meta.description}\n\n` +
            `GENERATED from "${workbookName}" by scripts/excel-to-contract.cjs — do not edit by hand.\n` +
            'Only rows with a real path and a known HTTP method are included; superseded (yellow), ' +
            'duplicate and legacy rows are excluded and listed in contracts/_conversion-report.json.\n' +
            'Schemas are inferred from the documented examples, so no property is marked required, ' +
            'and the workbook documents no status codes or auth requirements.',
        },
        servers: [{ url: meta.defaultServer }],
        components: {
          securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
        },
        paths,
      },
      null,
      2,
    )}\n`,
  );

  summary[product] = {
    rows: mine.length,
    usable: usable.length,
    operations: Object.values(paths).reduce((n, item) => n + Object.keys(item).length, 0),
    withRequest: usable.filter((r) => r.requestExample).length,
    withResponse: usable.filter((r) => r.responseExample).length,
  };
}

/* ------------------------------------------------------------------ types tab */

const typesSheet = sheets.find((s) => /^types/i.test(s.name));
const SECTION_BY_CELL = {
  A3: 'katchupStatus',
  A5: 'katchupShareType',
  C3: 'kallStatus',
  D3: 'kallStatus',
  C5: 'kallMode',
  E3: 'kmailType',
  E5: 'module',
  G3: 'kdiaryRemarks',
  I3: 'userType',
};
const HEADING_TO_SECTION = {
  messagetype: 'katchupMessageType',
  sharetype: 'katchupShareType',
  kalltype: 'kallType',
  kallmode: 'kallMode',
  kallrepeattype: 'kallRepeatType',
  kmailtype: 'kmailType',
  receivertype: 'kmailReceiverType',
  priority: 'kmailPriority',
  module: 'module',
  remarks: 'kdiaryRemarks',
};

const typeSections = {};
if (typesSheet) {
  for (const { row, cells } of rowsOf(typesSheet.name)) {
    for (const [col, text] of Object.entries(cells)) {
      let section = SECTION_BY_CELL[`${col}${row}`];
      if (!section) continue;
      for (const line of text.split('\n')) {
        const clean = line.trim().replace(/^[-–]\s*/, '');
        if (!clean) continue;
        const headingKey = clean.toLowerCase().replace(/[^a-z]/g, '');
        if (HEADING_TO_SECTION[headingKey]) {
          section = HEADING_TO_SECTION[headingKey];
          continue;
        }
        // 0- Sent | 1 ; // Reply | status = 2; Read | RECEIVER_TYPE_TO = 1;
        const numberFirst = /^(?:\w+\s*=\s*)?(\d+)\s*[-–;:=).]*\s*(?:\/\/)?\s*(.+)$/.exec(clean);
        const nameFirst = /^([A-Z_][A-Z_0-9]*)\s*=\s*(\d+)\s*;?$/.exec(clean);
        if (nameFirst) {
          (typeSections[section] ??= {})[nameFirst[2]] = nameFirst[1];
        } else if (numberFirst) {
          const label = numberFirst[2]
            .replace(/\s+/g, ' ')
            .replace(/[\s,.;]+$/, '')
            .trim();
          if (label && !/^=/.test(label)) (typeSections[section] ??= {})[numberFirst[1]] = label;
        } else {
          // A code with no number, optionally annotated: `BUSINESS_S (S stands for Small)`.
          const token = /^([A-Z][A-Z_0-9]*)\s*(?:\(([^)]*)\))?\s*$/.exec(clean);
          if (token) (typeSections[section] ??= {})[token[1]] = (token[2] || token[1]).trim();
        }
      }
    }
  }
}

fs.writeFileSync(
  path.join(contractsDir, 'kpost-types.json'),
  `${JSON.stringify({ source: workbookName, sheet: typesSheet?.name, generatedAt, sections: typeSections }, null, 2)}\n`,
);

fs.writeFileSync(
  path.join(contractsDir, '_conversion-report.json'),
  `${JSON.stringify({ source: workbookName, generatedAt, summary, excluded }, null, 2)}\n`,
);

/* ------------------------------------------------------------------ console summary */

const reasonCounts = {};
for (const item of excluded)
  for (const reason of item.reasons) {
    const key = reason.startsWith('duplicate-of') ? 'duplicate' : reason;
    reasonCounts[key] = (reasonCounts[key] ?? 0) + 1;
  }

console.log(`Workbook: ${workbookName}\n`);
for (const [product, s] of Object.entries(summary)) {
  console.log(
    `${product.padEnd(12)} rows=${String(s.rows).padStart(4)}  usable=${String(s.usable).padStart(4)}  ` +
      `openapi-operations=${String(s.operations).padStart(4)}  withRequest=${s.withRequest}  withResponse=${s.withResponse}`,
  );
}
console.log(`\nexcluded rows: ${excluded.length}`);
for (const [reason, count] of Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${reason.padEnd(22)} ${count}`);
}
console.log(
  `\ntype sections: ${Object.keys(typeSections).length} (${Object.keys(typeSections).join(', ')})`,
);
console.log(
  '\nwritten: contracts/*.contract.json, contracts/kpost-types.json, openapi/*.openapi.json, contracts/_conversion-report.json',
);
