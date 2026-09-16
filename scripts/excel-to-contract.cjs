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
 *   - duplicate         same method+path already taken from a better row
 *   - legacy-v1         a devapi1/no-/v2 row whose /v2 twin exists
 *   - method-unknown    neither the workbook nor the payload rule below can settle the method.
 *                       Nothing currently hits this; it is kept as the honest exit.
 *   - request/response-unparseable  the cell mixes prose into the JSON, so no schema is inferred
 *                       (the endpoint is still usable — only its schema is missing)
 *
 * ## How the HTTP method is decided, in order
 *
 *   1. the request cell states a method AND the payload agrees with it ("GET METHOD" with no
 *      payload) — this wins even over a Method column, because on KMail the column predates
 *      tokens while the "After Token Implemented" cell describes today's contract
 *   2. a Method column
 *   3. a stated method the payload contradicts — used, but flagged for confirmation
 *   4. the owner's payload rule: a documented payload means POST, none means GET
 *
 * Every endpoint records which applied (`methodSource`), why a column was overridden
 * (`methodNote`), and anything the rule might have got wrong (`methodDoubts`), so a derived
 * method is never mistaken for a documented one. All three reach the OpenAPI as x-method-*.
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
/**
 * The workbook lives in the repository, so a checkout has everything needed to regenerate the
 * contracts. The highest-numbered "KPOST API (N).xlsx" wins, since that is how the dumps arrive.
 */
function newestWorkbook() {
  const candidates = fs
    .readdirSync(ROOT)
    .filter((file) => /^KPOST API.*\.xlsx$/i.test(file) && !file.startsWith('~$'))
    .map((file) => ({ file, version: Number(/\((\d+)\)/.exec(file)?.[1] ?? 0) }))
    .sort((a, b) => b.version - a.version);
  return candidates.length ? path.join(ROOT, candidates[0].file) : undefined;
}

const SOURCE = process.argv[2] || process.env.KPOST_WORKBOOK || newestWorkbook();

if (!SOURCE || !fs.existsSync(SOURCE)) {
  console.error(
    SOURCE
      ? `workbook not found: ${SOURCE}`
      : 'no workbook found: put "KPOST API (N).xlsx" in the repository root',
  );
  console.error('usage: node scripts/excel-to-contract.cjs "<path to KPOST API (N).xlsx>"');
  process.exit(2);
}

/* ------------------------------------------------------------------ workbook reading */

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

/**
 * Unzip a .xlsx and return its sheet list plus a `rowsOf(sheetName)` reader. Factored into a
 * function so the converter can read MORE THAN ONE workbook with one parser — the KPost workbook
 * (KatchupAPI + KDIARY + … + KMAILAPI + Types) and the separate Admin module workbook. Each
 * workbook expands into its own temp directory; the yellow-fill (superseded) styling is per-book.
 */
function openWorkbook(sourcePath) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kpost-xlsx-'));
  const zip = path.join(tmp, 'workbook.zip'); // Expand-Archive insists on a .zip extension.
  fs.copyFileSync(sourcePath, zip);
  execFileSync('powershell', [
    '-NoProfile',
    '-Command',
    `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${tmp}' -Force`,
  ]);

  const shared = [
    ...read(path.join(tmp, 'xl', 'sharedStrings.xml')).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g),
  ].map((m) => textOf(m[1]));

  const stylesXml = read(path.join(tmp, 'xl', 'styles.xml'));
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
  for (const m of read(path.join(tmp, 'xl', '_rels', 'workbook.xml.rels')).matchAll(
    /Id="([^"]+)"[^>]*Target="([^"]+)"/g,
  )) {
    rels[m[1]] = m[2];
  }
  const sheets = [
    ...read(path.join(tmp, 'xl', 'workbook.xml')).matchAll(
      /<sheet\b[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g,
    ),
  ].map((m) => ({ name: decode(m[1]), target: rels[m[2]] }));

  function rowsOf(sheetName) {
    const sheet = sheets.find((s) => s.name === sheetName);
    if (!sheet) return [];
    const xml = read(path.join(tmp, 'xl', String(sheet.target).replace(/^\/?xl\//, '')));
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

  return { sheets, rowsOf };
}

/**
 * Source workbooks, keyed so a TAB can name the book it belongs to. KPost + KMail share one book
 * (the `KPOST API (N).xlsx` dump). (The Admin module is not here — it comes from the live service's
 * own OpenAPI via `scripts/fetch-admin-contract.cjs`.)
 */
const WORKBOOK_PATHS = { kpost: SOURCE };
const WORKBOOKS = { kpost: openWorkbook(SOURCE) };

// The Types tab and other kpost-only lookups read the KPost workbook directly.
const { sheets, rowsOf } = WORKBOOKS.kpost;

/* ------------------------------------------------------------------ tab layouts */

/**
 * Verified against KPOST API (5).xlsx. The tabs do not share a shape and guessing costs
 * correctness: on KatchupAPI a "first URL-shaped cell" rule picks column A (free-text notes that
 * quote URLs), and the real response sample is in N ("Tester Response"), not M.
 */
const TABS = [
  {
    sheet: 'KatchupAPI',
    expect: { J: 'Module', K: 'End Point', L: 'Request', N: 'Tester Response' },
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
    expect: { C: 'Method', D: 'URL Path', E: 'Parameters / Request', F: 'Sample Response' },
    product: 'kpost-api',
    module: 'B',
    url: 'D',
    methodColumn: 'C',
    request: ['E'],
    response: ['F'],
  },
  {
    sheet: 'V2 TESTED APIS',
    expect: { B: 'METHOD', C: 'URL', D: 'PARAMS', F: 'RESPONSE' },
    product: 'kpost-api',
    url: 'C',
    methodColumn: 'B',
    request: ['D'],
    response: ['F'],
  },
  {
    sheet: 'Sheet3',
    expect: { C: 'URL', D: 'PARAMS', F: 'RESPONSE' },
    product: 'kpost-api',
    url: 'C',
    methodColumn: null,
    request: ['D'],
    response: ['F'],
  },
  {
    sheet: 'KMAILAPI',
    expect: { C: 'Method', D: 'URL Path', G: 'Sample Response' },
    product: 'kmail-api',
    module: 'B',
    url: 'D',
    methodColumn: 'C',
    // Later rows moved the current body into E (no before/after token split), so E is the
    // fallback whenever F is blank.
    request: ['F', 'E'],
    response: ['G'],
  },
  // The Admin module is NOT converted from Excel: the live service publishes its own accurate OpenAPI
  // (112 ops) at /v3/api-docs, which `scripts/fetch-admin-contract.cjs` (npm run contract:admin) turns
  // into openapi/admin-api.openapi.json. The `Admin_module.xlsx` was a simplified/inaccurate subset.
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

/** Which source workbook each product's rows come from, for the per-product `source` label. */
const PRODUCT_WORKBOOK = {
  'kpost-api': 'kpost',
  'kmail-api': 'kpost',
};

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/* --------------------------------------------------- request cells and HTTP methods */

/**
 * What a request cell actually says. The workbook uses a small, consistent vocabulary that is not
 * JSON, and reading it literally is what makes the method derivable:
 *
 *   "GET METHOD"                    the endpoint takes no body (79 rows on KatchupAPI)
 *   "Not Required" / "NOT REQUIRED" the same thing, said differently
 *   "Not needed API changed in V2"  the row is stale, not a live contract
 *   "UNUSED"                        retired
 *   "multipart key : file"          there IS a body, but a file upload rather than JSON
 *
 * KMail's two request columns mean different eras: E is pre-token, F is "After Token Implemented".
 * F wins because it describes today's contract - and F very often says "GET METHOD" where E still
 * shows a `{kpostUser}` payload, because the user now comes from the JWT. Reporting those as
 * "missing payload" was wrong: there is nothing to fill in.
 */
const NO_BODY_NOTE =
  /^\s*(not\s*(required|needed)|no\s*(payload|params?|body)?|none|nil|n\/?a|unused)\b/i;
const RETIRED_NOTE = /\b(unused|not\s*needed|api\s*changed|no\s*longer|deprecated|removed)\b/i;
const MULTIPART_NOTE = /\b(multipart|form-?data)\b/i;
/** "GET METHOD" - the word METHOD is required, so a payload mentioning "post" is not a method. */
const STATED_METHOD = new RegExp(`\\b(${METHODS.join('|')})\\s*METHOD\\b`, 'i');

/**
 * @returns {{kind: 'json'|'none'|'multipart'|'unparseable'|'unclear', statedMethod?: string,
 *            retiredNote?: boolean, body?: object, raw?: string}}
 */
function classifyRequest(text) {
  const trimmed = (text ?? '').trim();
  const statedMethod = STATED_METHOD.exec(trimmed)?.[1]?.toUpperCase();
  const retiredNote = !trimmed.includes('{') && RETIRED_NOTE.test(trimmed);
  if (!trimmed) return { kind: 'none' };
  if (trimmed.includes('{')) {
    const parsed = parseBody(trimmed);
    return parsed.ok
      ? { kind: 'json', body: parsed.value, raw: parsed.raw, statedMethod }
      : { kind: 'unparseable', raw: parsed.raw, statedMethod, retiredNote };
  }
  if (MULTIPART_NOTE.test(trimmed)) return { kind: 'multipart', statedMethod, retiredNote };
  if (statedMethod || NO_BODY_NOTE.test(trimmed))
    return { kind: 'none', statedMethod, retiredNote };
  return { kind: 'unclear', statedMethod, retiredNote };
}

/**
 * The HTTP method, with its provenance recorded so nothing has to be taken on trust.
 *
 * The workbook wins wherever it states a method. Where it does not, the rule given by the API
 * owner applies: **a documented request payload means POST, no payload means GET.**
 *
 * ## This API uses only POST and GET
 *
 * Confirmed by the owner and corroborated by the workbook: across all 95 rows that state a method,
 * the values are POST (80) and GET (15) - there is no PUT, PATCH or DELETE anywhere. So an
 * `updateX` or `deleteX` endpoint with a payload is a **POST** here, and the rule is binary rather
 * than a guess needing confirmation. A workbook that later states PUT or DELETE is still honoured;
 * it is only the derivation that is limited to POST and GET.
 *
 * Everything is labelled `payload-rule` where it lands - the contract record, the OpenAPI
 * (`x-method-source`) and the gap list - so a derived method is never mistaken for a documented
 * one, and the only thing still flagged is a method the workbook contradicts itself about.
 */
function resolveMethod({ columnMethod, request }) {
  const doubts = [];
  const stated = METHODS.includes(request.statedMethod ?? '') ? request.statedMethod : undefined;
  const hasBody =
    request.kind === 'json' || request.kind === 'multipart' || request.kind === 'unparseable';

  /*
   * When the request cell states a method AND the payload agrees with it, the cell wins - even
   * over a Method column that says otherwise. This is the owner's rule and it settles KMail's 7
   * apparent contradictions: column C says POST from before tokens existed, while the
   * "After Token Implemented" cell says `GET METHOD` and documents no payload. The later
   * statement, corroborated by the absence of a payload, is the live contract.
   *
   * "Agrees" means: GET with no payload, or a body method with a payload. DELETE is accepted
   * either way, since a DELETE legitimately has no body.
   */
  const statedAgreesWithPayload =
    stated === 'GET' ? !hasBody : stated === 'DELETE' ? true : stated ? hasBody : false;

  if (stated && statedAgreesWithPayload) {
    return {
      method: stated,
      source: 'request-note',
      doubts,
      // The displaced value, kept as data so no reader has to parse the sentence below.
      overrode: columnMethod && columnMethod !== stated ? columnMethod : undefined,
      note:
        columnMethod && columnMethod !== stated
          ? `the request cell states ${stated} and documents ${
              hasBody ? 'a payload' : 'no payload'
            }, so it overrides the Method column (${columnMethod})`
          : undefined,
    };
  }

  // Only a stated method the payload contradicts is still a conflict worth a human decision.
  if (columnMethod && stated && columnMethod !== stated) {
    doubts.push(
      `method-conflict: column says ${columnMethod}, request cell says ${stated}, and the cell ` +
        `documents ${hasBody ? 'a payload' : 'no payload'}`,
    );
  }
  if (columnMethod) return { method: columnMethod, source: 'method-column', doubts };
  if (stated) {
    doubts.push(
      `the request cell says ${stated} but documents ${hasBody ? 'a payload' : 'no payload'}`,
    );
    return { method: stated, source: 'request-note', doubts };
  }

  if (!hasBody && request.kind !== 'none') return { method: null, source: 'unknown', doubts };

  /*
   * Binary by design. An earlier version flagged `updateX` as "might be PUT" and `deleteX` as
   * "might be DELETE", which put 34 endpoints in front of the owner for no reason: this API has
   * neither verb. A payload whose sample JSON is broken is still a payload, so it is still a POST -
   * the broken sample is a schema gap (P3), not a method question.
   */
  return { method: hasBody ? 'POST' : 'GET', source: 'payload-rule', doubts };
}

/* ------------------------------------------------------------- layout verification */

/**
 * The layout above addresses cells by column LETTER, which holds only while the columns stay put.
 * Inserting a column in the workbook shifts every letter after it, and the converter would then
 * read the wrong cells and say nothing about it. Two protections:
 *
 *   1. verifyHeaders  - each labelled column must still carry its expected header, or we stop.
 *   2. methodColumnOf - the Method column is found BY HEADER, so a Method column added to a tab
 *                       that has none (KatchupAPI, Sheet3) is picked up with no code change.
 *                       Append it after the last used column so no existing letter moves.
 */
const HEADER_SCAN_ROWS = 12;
const METHOD_HEADER = /^(http\s*)?method$/i;
const norm = (v) =>
  String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/** The column whose header reads "Method", else the layout's column, else none. */
function methodColumnOf(tab, rows) {
  for (const { cells } of rows.slice(0, HEADER_SCAN_ROWS)) {
    for (const [col, value] of Object.entries(cells)) {
      if (METHOD_HEADER.test(norm(value))) return col;
    }
  }
  return tab.methodColumn;
}

/** Stops the run when a labelled column no longer holds its header - a wrong column is silent. */
function verifyHeaders(tab, rows) {
  if (!tab.expect) return;
  const expected = Object.entries(tab.expect);
  const header = rows
    .slice(0, HEADER_SCAN_ROWS)
    .find((r) => expected.every(([col, text]) => norm(r.cells[col]) === norm(text)));
  if (header) return;
  const seen = expected
    .map(([col, text]) => {
      const found =
        rows
          .slice(0, HEADER_SCAN_ROWS)
          .map((r) => r.cells[col])
          .find((v) => String(v ?? '').trim()) ?? '';
      return `${col}="${norm(found).slice(0, 30)}" (expected "${text}")`;
    })
    .join(', ');
  console.error(`layout changed on tab "${tab.sheet}" - refusing to convert.`);
  console.error(`  ${seen}`);
  console.error(
    '  A column was inserted or renamed, so the letters in TABS no longer point at the right',
  );
  console.error('  cells. Add new columns AFTER the last used one, or update TABS in this script.');
  process.exit(3);
}

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
/*
 * ## Response types permit null; request types do not
 *
 * For a RESPONSE, one example proves a type was observed, never that null is forbidden - the same
 * reason no property is marked `required`. Not theoretical: the documented
 * `/v2/common/countries` sample shows `"fieldCount": "6"`, while the live API returns `null` for
 * 236 of its 240 countries. Asserting "string" produced 236 violations on one endpoint and buried
 * the real findings under them. A genuine mismatch (a string where a number is documented) still
 * fails.
 *
 * For a REQUEST the opposite holds. The negative probes send null into each documented field and
 * expect a 4xx; a nullable request schema would mean "the contract permits null", the probe would
 * be skipped as not-invalid, and a real defect would go unreported - exactly what happened to
 * `POST /v2/common/languages`, which accepts `{"countryID": null}` and answers 200 with the rows
 * for country 0.
 */
function inferSchema(value, nullable = false) {
  const type = (name) => (nullable ? [name, 'null'] : name);
  if (Array.isArray(value)) {
    return {
      type: type('array'),
      items: value.length ? inferSchema(value[0], nullable) : {},
    };
  }
  if (value === null) return {};
  switch (typeof value) {
    case 'string':
      return { type: type('string') };
    case 'number':
      return { type: type(Number.isInteger(value) ? 'integer' : 'number') };
    case 'boolean':
      return { type: type('boolean') };
    case 'object':
      return {
        type: type('object'),
        properties: Object.fromEntries(
          Object.entries(value).map(([k, v]) => [k, inferSchema(v, nullable)]),
        ),
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

/**
 * Some workbooks write a base-URL placeholder in front of every route (Admin: `{AdminURL}/route`)
 * instead of a real host. The leading placeholder is the server base, so it is dropped; any further
 * `{Placeholder}` left in the path was used in place of a path-param VALUE, so it becomes a numbered
 * path parameter (`{param1}`, `{param2}`) rather than a duplicate, invalid one.
 */
const stripBasePlaceholder = (value, placeholder) => {
  if (!placeholder || !value) return value;
  const one = `\\{${placeholder}\\}`;
  let v = value.replace(new RegExp(`^\\s*${one}\\/?`), '/');
  let n = 0;
  v = v.replace(new RegExp(one, 'g'), () => `{param${(n += 1)}}`);
  return v;
};

const operationIdFrom = (name, method, pathname) => {
  const fromName = (name || '').trim().split(/\s+/)[0];
  if (fromName && /^[A-Za-z][\w-]*$/.test(fromName)) return fromName;
  const segments = pathname.split('/').filter((s) => s && !s.startsWith('{'));
  const tail = segments.slice(-2).join('-') || 'root';
  return `${method.toLowerCase()}-${tail}`.replace(/[^\w-]/g, '');
};

/** Column letters, so the gap report can name the exact cell to fill. */
const colIndex = (letters) => [...letters].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);
const colLetters = (index) => {
  let out = '';
  let n = index;
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = (n - rem - 1) / 26;
  }
  return out;
};

/** The first column after everything the tab uses - where a new column is safe to add. */
function firstFreeColumn(rows) {
  let max = 0;
  for (const { cells } of rows) {
    for (const col of Object.keys(cells)) max = Math.max(max, colIndex(col));
  }
  return colLetters(max + 1);
}

/* ------------------------------------------------------------------ extraction */

const records = [];
const tabLayouts = [];

for (const tab of TABS) {
  const workbook = WORKBOOKS[tab.workbook ?? 'kpost'];
  if (!workbook) continue; // e.g. the Admin workbook is absent — no admin-api output, no failure.
  const tabRows = workbook.rowsOf(tab.sheet);
  verifyHeaders(tab, tabRows);
  const methodColumn = methodColumnOf(tab, tabRows);
  if (methodColumn && methodColumn !== tab.methodColumn) {
    console.log(`${tab.sheet}: reading HTTP method from column ${methodColumn} (found by header)`);
  }
  tabLayouts.push({
    sheet: tab.sheet,
    product: tab.product,
    methodColumn,
    methodColumnSource: !methodColumn
      ? 'none'
      : methodColumn === tab.methodColumn
        ? 'layout'
        : 'header',
    // Where to put a Method column on a tab that has none: after everything already in use, so
    // no existing column letter shifts.
    firstFreeColumn: firstFreeColumn(tabRows),
  });
  for (const { row, cells, yellow } of tabRows) {
    const urlCell = stripBasePlaceholder((cells[tab.url] ?? '').trim(), tab.basePlaceholder);
    /*
     * The layout column is authoritative, with a fallback: some rows hold junk in it (R66 has
     * " z", R95 is empty, R99 holds the JSON payload) while the real URL sits in the notes
     * column. Without this, those endpoints are dropped silently — proven by
     * scripts/contract-coverage.cjs, which scans every column independently.
     */
    const looksLikeEndpoint = (v) => /^https?:\/\//.test(v) || /^\/?[a-zA-Z][\w-]*\//.test(v);
    const fallbackCell = looksLikeEndpoint(urlCell)
      ? ''
      : (Object.keys(cells)
          .sort()
          .map((col) => (cells[col] ?? '').trim())
          .find((v) => /^https?:\/\//.test(v)) ?? '');
    const usedFallback = !looksLikeEndpoint(urlCell) && Boolean(fallbackCell);
    const urls = (looksLikeEndpoint(urlCell) ? urlCell : fallbackCell)
      .split(/\s+/)
      .filter((u) => looksLikeEndpoint(u));
    if (!urls.length) continue;

    const requestText = firstCell(cells, tab.request);
    const responseText = firstCell(cells, tab.response);
    const columnMethodCell = (cells[methodColumn] ?? '').trim().toUpperCase();
    const columnMethod = METHODS.includes(columnMethodCell) ? columnMethodCell : undefined;

    /*
     * "endKall url changed to endKoolKall" (KatchupAPI R88) is ONE endpoint that moved, not two.
     * Splitting it produced a phantom /v2/kall/endKall. The last URL is the current one.
     */
    const urlChanged = /\b(url\s+)?changed\s+to\b/i.test(urlCell) && urls.length > 1;
    const liveUrls = urlChanged ? [urls[urls.length - 1]] : urls;
    const replacedUrl = urlChanged ? toPath(urls[0]) : undefined;

    /*
     * A row documenting two endpoints pairs its payloads with its URLs positionally. When there is
     * only ONE payload for two URLs (R3: both fetchUserDetails variants; R88 before the fix), the
     * old rule discarded it and both endpoints were reported as having no payload - which is what
     * the workbook owner caught. The payload is now shared and labelled.
     */
    const bodies = jsonBlocks(requestText);
    const sharedPayload = liveUrls.length > 1 && bodies.length === 1;

    for (const [index, url] of liveUrls.entries()) {
      const pathname = toPath(url);
      if (!/^\/[a-zA-Z]/.test(pathname)) continue;

      const ownRequestText =
        liveUrls.length === 1
          ? requestText
          : bodies.length === liveUrls.length
            ? bodies[index]
            : sharedPayload
              ? bodies[0]
              : requestText;
      const request = classifyRequest(ownRequestText);
      const response = parseBody(responseText);
      const name = (cells[tab.name] ?? '').trim().split(/\s+/)[index] || undefined;
      const resolved = resolveMethod({ columnMethod, request, name, path: pathname });
      const method = resolved.method;
      /*
       * A row that only quotes a base URL in a notes column is not an endpoint: KMAILAPI R1 holds
       * the tab header "https://kmail5.kpostindia.com/kmail5/v2/" and documents nothing. A
       * fallback URL is accepted only when the row really describes a call.
       */
      if (usedFallback && !columnMethod && request.kind === 'none' && !response.ok) continue;
      const doubts = [...resolved.doubts];
      /*
       * Not a doubt about the method - a note about the data. Keeping these out of methodDoubts
       * is what lets "methods needing confirmation" mean exactly that.
       */
      const notes = [];
      if (sharedPayload) {
        notes.push('one payload is documented for the two endpoints in this row');
      }
      const reasons = [];
      /*
       * Yellow fill = unused, confirmed by the owner: those endpoints are not added. A request
       * cell that says so in words ("UNUSED", "Not needed API changed in V2") means the same
       * thing, so it retires the row too rather than being reported as a gap to chase.
       */
      if (yellow[tab.url] || yellow[tab.module]) reasons.push('superseded');
      if (request.retiredNote) reasons.push('unused-note');
      if (!method) reasons.push('method-unknown');
      if (request.kind === 'unparseable') reasons.push('request-unparseable');
      if (!response.ok && response.reason === 'prose mixed into the JSON')
        reasons.push('response-unparseable');

      records.push({
        product: tab.product,
        tab: tab.sheet,
        row,
        module: (cells[tab.module] ?? '').trim() || undefined,
        name,
        method,
        methodSource: resolved.source,
        methodNote: resolved.note,
        methodOverrode: resolved.overrode,
        methodDoubts: doubts.length ? doubts : undefined,
        dataNotes: notes.length ? notes : undefined,
        requestKind: request.kind,
        replacedUrl,
        path: pathname,
        sourceUrl: url,
        legacy:
          /devapi1/.test(url) || (!pathname.startsWith('/v2/') && tab.product === 'kpost-api'),
        requestExample: request.kind === 'json' ? request.body : undefined,
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

  /*
   * Completeness decides which duplicate survives; ties keep the earliest row.
   *
   * A retired row must never win: KMAILAPI R5 ("Not needed API changed in V2") and R37 document
   * the same path, and R5 won on an earlier-row tie-break. Retiring R5 as unused would then have
   * taken the path out of the contracts altogether while R37 sat there marked "duplicate" - the
   * endpoint would simply vanish, and the coverage audit could not see it because both rows are
   * still contract records. Hence the heavy penalty rather than a filter.
   */
  const retired = (r) => r.reasons.includes('superseded') || r.reasons.includes('unused-note');
  const score = (r) =>
    (r.requestExample ? 2 : 0) +
    (r.responseExample ? 2 : 0) +
    (r.legacy ? -1 : 0) -
    (retired(r) ? 100 : 0);
  const best = new Map();
  for (const record of mine) {
    if (!record.method) continue;
    const key = `${record.method} ${record.path.replace(/\/+$/, '')}`;
    const incumbent = best.get(key);
    if (!incumbent || score(record) > score(incumbent)) {
      if (incumbent) incumbent.reasons.push(`duplicate-of ${record.tab}:R${record.row}`);
      best.set(key, record);
    } else {
      record.reasons.push(`duplicate-of ${incumbent.tab}:R${incumbent.row}`);
    }
  }

  const blocking = new Set(['superseded', 'unused-note', 'method-unknown', 'legacy-v1']);
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
  // Each product names the workbook its rows actually came from (Admin has its own file).
  const wbName = path.basename(WORKBOOK_PATHS[PRODUCT_WORKBOOK[product]] ?? SOURCE);
  const usable = mine
    .filter((r) => r.usable)
    .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

  fs.writeFileSync(
    path.join(contractsDir, `${product}.contract.json`),
    `${JSON.stringify(
      {
        source: wbName,
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
      /*
       * Provenance travels with the document. A reader of the OpenAPI alone must be able to see
       * that a method was derived from the payload rule rather than documented, and whether it is
       * one of the ones awaiting confirmation.
       */
      'x-method-source': record.methodSource,
      'x-method-note': record.methodNote,
      'x-method-doubts': record.methodDoubts,
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
                  schema: inferSchema(record.responseExample, true),
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
    if (!operation['x-method-doubts']) delete operation['x-method-doubts'];
    if (!operation['x-method-note']) delete operation['x-method-note'];

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
          version: wbName,
          description:
            `${meta.description}\n\n` +
            `GENERATED from "${wbName}" by scripts/excel-to-contract.cjs — do not edit by hand.\n` +
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
  `${JSON.stringify(
    {
      source: workbookName,
      // The audit reads this so it can never check a different workbook than the one converted.
      sourcePath: path.resolve(SOURCE),
      generatedAt,
      summary,
      tabs: tabLayouts,
      excluded,
    },
    null,
    2,
  )}\n`,
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
