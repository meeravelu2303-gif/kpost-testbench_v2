#!/usr/bin/env node
/**
 * Builds openapi/admin-api.openapi.json from the Admin service's own OpenAPI (ADMIN_API_BASE_URL,
 * /v3/api-docs) with every $ref inlined; falls back to the cached contracts/admin-api.source.json.
 *
 *   node scripts/fetch-admin-contract.cjs ["<api-docs url>"]
 *   npm run contract:admin
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
require(path.join(ROOT, 'node_modules', 'dotenv')).config({
  path: path.join(ROOT, '.env'),
  quiet: true,
});
// The Admin test box from `.env`; an explicit api-docs URL argument wins.
const SERVER = (process.env.ADMIN_API_BASE_URL || '').replace(/\/+$/, '');
const URL = process.argv[2] || (SERVER ? `${SERVER}/v3/api-docs` : '');
if (!URL) {
  console.error(
    'no Admin service configured: set ADMIN_API_BASE_URL in .env (the Admin test box) or pass the api-docs URL',
  );
  process.exit(2);
}
const CACHE = path.join(ROOT, 'contracts', 'admin-api.source.json');
const OUT = path.join(ROOT, 'openapi', 'admin-api.openapi.json');

async function loadSource() {
  try {
    const res = await fetch(URL, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const doc = await res.json();
    fs.writeFileSync(CACHE, `${JSON.stringify(doc, null, 2)}\n`);
    console.log(`fetched ${URL} → cached to contracts/admin-api.source.json`);
    return doc;
  } catch (err) {
    if (fs.existsSync(CACHE)) {
      console.warn(`fetch failed (${err.message}); using cached contracts/admin-api.source.json`);
      return JSON.parse(fs.readFileSync(CACHE, 'utf8'));
    }
    console.error(`Could not fetch ${URL} and no cache exists: ${err.message}`);
    process.exit(2);
  }
}

/** Inline every $ref against the document's component schemas, guarding cycles. */
function dereference(schemas) {
  const deref = (node, seen) => {
    if (Array.isArray(node)) return node.map((n) => deref(n, seen));
    if (!node || typeof node !== 'object') return node;
    if (typeof node.$ref === 'string') {
      const name = node.$ref.replace('#/components/schemas/', '');
      if (seen.has(name)) return { type: 'object' }; // cycle — stop, shallow object
      const target = schemas[name];
      if (!target) return { type: 'object' };
      return deref(target, new Set([...seen, name]));
    }
    const out = {};
    for (const [key, value] of Object.entries(node)) out[key] = deref(value, seen);
    return out;
  };
  return (node) => deref(node, new Set());
}

(async () => {
  const source = await loadSource();
  const schemas = source.components?.schemas ?? {};
  const inline = dereference(schemas);

  const paths = {};
  let operations = 0;
  for (const [p, item] of Object.entries(source.paths ?? {})) {
    for (const [method, op] of Object.entries(item)) {
      if (method === 'parameters' || !op || typeof op !== 'object') continue;
      operations += 1;
      const built = {
        operationId: op.operationId || `${method}-${p}`.replace(/[^\w-]/g, ''),
        summary: op.summary || `${method.toUpperCase()} ${p}`,
        tags: op.tags,
        'x-method-source': 'live-openapi',
        parameters: op.parameters,
        responses: {},
      };
      // Request body schema, dereferenced.
      const reqJson = op.requestBody?.content?.['application/json'];
      if (reqJson?.schema) {
        built.requestBody = {
          content: {
            'application/json': {
              schema: inline(reqJson.schema),
              ...(reqJson.example !== undefined ? { example: reqJson.example } : {}),
            },
          },
        };
      }
      // 200 response schema, dereferenced.
      const okJson = op.responses?.['200']?.content?.['application/json'];
      built.responses['200'] = okJson?.schema
        ? {
            description: op.responses['200'].description || 'Success',
            content: { 'application/json': { schema: inline(okJson.schema) } },
          }
        : { description: op.responses?.['200']?.description || 'Success' };

      if (!built.tags) delete built.tags;
      if (!built.parameters) delete built.parameters;
      paths[p] ??= {};
      paths[p][method] = built;
    }
  }

  const doc = {
    openapi: '3.1.0',
    info: {
      title: 'KPost Admin API',
      version: 'live',
      description:
        'KPost Admin module API — organisation / workplace / HR / role / employee setup.\n\n' +
        `GENERATED from the live service OpenAPI (${URL}) by scripts/fetch-admin-contract.cjs — do ` +
        'not edit by hand. $refs are inlined. Refresh with `npm run contract:admin`.',
    },
    servers: [{ url: SERVER }],
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    },
    paths,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`written: openapi/admin-api.openapi.json — ${operations} operations`);
})();
