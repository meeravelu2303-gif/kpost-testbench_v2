#!/usr/bin/env node
/**
 * Duplicate gate for hand-filed bugs: searches every status for the keywords and exits non-zero on
 * any match, so "no output, exit 0" is the only green light to file.
 *
 *   node scripts/bug-tracker/duplicate-check.cjs "<product>" "<component>" "<keyword>" ["<keyword2>" ...]
 *
 * Example:
 *   node scripts/bug-tracker/duplicate-check.cjs "KPost UI" "Auth" "forgotPasswordUpdate" "zero feedback"
 */
'use strict';

const fs = require('fs');
const path = require('path');

function loadEnv() {
  const envPath = path.join(__dirname, '..', '..', '.env');
  const out = {};
  if (!fs.existsSync(envPath)) return out;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const JUDGED_NOT_A_DEFECT = new Set(['INVALID', 'WONTFIX', 'WORKSFORME', 'DUPLICATE']);

async function main() {
  const [product, component, ...keywords] = process.argv.slice(2);
  if (!product || !component || keywords.length === 0) {
    console.error(
      'Usage: node scripts/bug-tracker/duplicate-check.cjs "<product>" "<component>" "<keyword>" [...]',
    );
    process.exit(2);
  }

  const env = loadEnv();
  const url = (env.BUGZILLA_URL || '').replace(/\/+$/, '');
  const apiKey = env.BUGZILLA_API_KEY;
  if (!url || !apiKey) {
    console.error('BUGZILLA_URL / BUGZILLA_API_KEY not set in .env');
    process.exit(2);
  }

  console.log(
    `Checking for existing bugs in "${product}" / "${component}" matching: ${keywords.join(', ')}\n`,
  );

  const seen = new Map();
  for (const kw of keywords) {
    const qs = new URLSearchParams({
      product,
      component,
      summary: kw,
      include_fields: 'id,summary,status,resolution',
      api_key: apiKey,
    });
    const res = await fetch(`${url}/bug?${qs.toString()}`);
    const json = await res.json();
    for (const b of json.bugs || []) seen.set(b.id, b);
  }

  if (seen.size === 0) {
    console.log('No matches found — clear to file.');
    process.exit(0);
  }

  console.log(`Found ${seen.size} existing bug(s) with overlapping wording:\n`);
  let anyBlocking = false;
  for (const b of [...seen.values()].sort((a, b2) => a.id - b2.id)) {
    const judged = JUDGED_NOT_A_DEFECT.has((b.resolution || '').toUpperCase());
    const tag = judged ? '  <- judged not a defect, NEVER refile this' : '';
    console.log(
      `  #${b.id}  ${b.status}${b.resolution ? ' ' + b.resolution : ''}  — ${b.summary}${tag}`,
    );
    anyBlocking = true;
  }
  console.log(
    '\nDo not file a new bug until you have read each match above and decided: comment on an ' +
      'existing OPEN one, skip entirely (judged not a defect), or confirm this is genuinely a ' +
      'different defect before filing fresh.',
  );
  process.exit(anyBlocking ? 1 : 0);
}

main();
