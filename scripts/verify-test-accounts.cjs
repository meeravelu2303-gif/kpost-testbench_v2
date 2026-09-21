#!/usr/bin/env node
/**
 * Reconciles `src/fixtures/test-accounts.json` against the live KPOST_QA database.
 *
 * The registry records what the bench BELIEVES exists; this asks the database what actually does.
 * They drift in both directions and each direction is its own problem:
 *
 *  - `provisioned: true` for an account that is gone → specs fail with a login error and the cause
 *    looks like an API defect.
 *  - `provisioned: false` for an account that exists → specs skip, and the bench silently reports
 *    less coverage than it could deliver.
 *
 * Read-only: it issues SELECTs and prints a report. It never edits the registry, because marking an
 * account live is a decision about whether the account is *usable* (password set, correct type, in
 * the right company), not merely whether a row exists.
 *
 * Usage: npm run accounts:verify
 */
require('dotenv').config({ path: '.env', quiet: true });

const fs = require('node:fs');
const path = require('node:path');

const REGISTRY = path.join(__dirname, '..', 'src', 'fixtures', 'test-accounts.json');

function resolveHost(value) {
  if (!value) return undefined;
  const authority = value.replace(/^[a-z+]+:(?:\/\/)?/i, '').split(/[/?]/)[0] ?? '';
  return (/^(\[[^\]]+\]|[^:]+)(?::\d+)?$/.exec(authority) ?? [])[1];
}

(async () => {
  const registry = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
  const policy = registry.domainPolicy;
  const identifier = new RegExp(policy.identifierPattern);
  const accounts = registry.accounts;

  /** Mirrors `policyViolation()` in test-accounts.ts — the prefix, then the type's domain. */
  const violation = (account) => {
    const at = account.kpostId.lastIndexOf('@');
    const local = account.kpostId.slice(0, at);
    const domain = account.kpostId.slice(at + 1).toLowerCase();
    if (!local.startsWith(policy.prefix)) return `missing "${policy.prefix}" prefix`;
    if (!identifier.test(local.slice(policy.prefix.length))) return 'bad identifier';
    const expected = policy[account.userType];
    if (domain !== expected) return `${account.userType} must be on @${expected}, is on @${domain}`;
    return undefined;
  };

  console.log(
    `Registry: ${accounts.length} account(s). Domains: PERSONAL @${policy.PERSONAL}, ` +
      `BUSINESS_* @${policy.BUSINESS_M}\n`,
  );

  const offenders = accounts.map((a) => [a, violation(a)]).filter(([, reason]) => reason);
  if (offenders.length) {
    console.log('POLICY VIOLATIONS (these would be refused by the QA-identifier guard):');
    offenders.forEach(([a, reason]) => console.log(`  ${a.id}: ${a.kpostId} — ${reason}`));
    console.log('');
  }

  const host = resolveHost(process.env.DB_HOST);
  if (!host || !process.env.DB_NAME) {
    console.log('No database configured (DB_HOST / DB_NAME), so existence was NOT verified.');
    console.log('Registry state is reported as-is:\n');
    accounts.forEach((a) =>
      console.log(`  ${a.provisioned ? 'claimed live' : 'not provisioned'}  ${a.kpostId}`),
    );
    process.exitCode = 0;
    return;
  }

  const mysql = require('mysql2/promise');
  const pool = mysql.createPool({
    host,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl:
      process.env.DB_SSL === 'false'
        ? undefined
        : { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' },
    connectionLimit: 3,
    bigNumberStrings: true,
    multipleStatements: false,
  });

  let drift = 0;
  try {
    for (const account of accounts) {
      const [rows] = await pool.query(
        'SELECT kpost_id, user_type, active_status, company_id FROM `TBL_KPOST_USER_MASTER` WHERE `kpost_id` = ? LIMIT 1',
        [account.kpostId],
      );
      const row = rows[0];
      const exists = Boolean(row);
      const active = exists && String(row.active_status).toLowerCase() === 'yes';
      const passwordSet = Boolean(process.env[account.passwordEnv]);

      let verdict;
      if (account.provisioned && !exists) {
        verdict = 'DRIFT: registry says live, database has no such account';
      } else if (!account.provisioned && exists) {
        verdict = 'DRIFT: account exists but registry says not provisioned';
      } else if (exists && !active) {
        verdict = 'DRIFT: account exists but active_status is not "yes"';
      } else if (exists && row.user_type !== account.userType) {
        verdict = `DRIFT: user_type is ${row.user_type}, registry expects ${account.userType}`;
      } else if (account.provisioned && !passwordSet) {
        verdict = `UNUSABLE: ${account.passwordEnv} is not set`;
      } else {
        verdict = exists ? 'ok (live)' : 'ok (not provisioned, as recorded)';
      }
      if (verdict.startsWith('DRIFT') || verdict.startsWith('UNUSABLE')) drift += 1;

      console.log(`  ${account.kpostId.padEnd(34)} ${verdict}`);
    }
  } finally {
    await pool.end();
  }

  console.log(
    `\n${drift === 0 ? 'Registry matches the database.' : `${drift} account(s) need attention.`}`,
  );
  // Non-zero only for drift, so CI can gate on it without failing when accounts are simply absent.
  process.exitCode = drift === 0 ? 0 : 1;
})().catch((error) => {
  console.error('verify-test-accounts failed:', error.message);
  process.exitCode = 1;
});
