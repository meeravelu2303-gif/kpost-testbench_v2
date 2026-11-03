// The throwaway account a phone signup test creates, and its removal afterwards (QA DB only).
//
//   node scripts/mobile/signup-account.mjs pick              → {"local","kpostId","mobile"} on stdout
//   node scripts/mobile/signup-account.mjs delete <kpostId> <mobile>
//
// The app's own "Delete account" texts the account's phone and only deactivates, so the rows are
// deleted directly, children first; every statement binds this account's exact KPOST ID or mobile.
// `mobkpost<N>` / `90000009NN` keep the phone's accounts apart from the web's `sanitykpost<N>` /
// `90000008NN` (tests/kpost-ui/support/sanity-account.ts, whose SIGNUP_FOOTPRINT this mirrors).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');
const env = dotenv.parse(fs.readFileSync(path.join(ROOT, '.env')));

const DOMAIN = 'kpostindia.com';
const USER_TABLE = 'TBL_KPOST_USER_MASTER';
const FOOTPRINT = [
  ['TBL_KPOST_LOGIN_SESSION', 'kpost_id', 'id'],
  ['TBL_KPOST_LOGIN_HISTORY', 'kpost_id', 'id'],
  ['TBL_KPOST_USER_PROFILE', 'kpost_id', 'id'],
  ['TBL_KPOST_USERS_KMAIL_SETTINGS', 'kpost_id', 'id'],
  ['TBL_KPOST_USER_PHONECONTACT_DETAILS', 'kpost_id', 'id'],
  ['TBL_KPOST_KATCHUP_MESSAGES', 'receiver', 'id'],
  ['TBL_KPOST_OTP_VALIDATION', 'mobile_number', 'mobile'],
  [USER_TABLE, 'kpost_id', 'id'],
];

function fail(message) {
  console.error(`signup-account: ${message}`);
  process.exit(1);
}

async function connect() {
  const [host, port] = String(env.DB_HOST ?? '').split(':');
  if (host !== '192.168.0.100')
    fail(`DB_HOST is ${host || 'unset'}; only the QA DB (192.168.0.100)`);
  return mysql.createConnection({
    host,
    port: Number(port || 3306),
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME || 'kpost',
  });
}

async function pick(db) {
  const [taken] = await db.query(
    `SELECT kpost_id, mobile_number FROM ${USER_TABLE} WHERE kpost_id LIKE ? OR mobile_number LIKE ?`,
    [`mobkpost%@${DOMAIN}`, '90000009%'],
  );
  const ids = new Set(taken.map((r) => String(r.kpost_id).toLowerCase()));
  const mobiles = new Set(taken.map((r) => String(r.mobile_number)));
  for (let n = 1; n <= 99; n++) {
    const local = `mobkpost${n}`;
    const kpostId = `${local}@${DOMAIN}`;
    const mobile = `90000009${String(n).padStart(2, '0')}`;
    if (!ids.has(kpostId) && !mobiles.has(mobile)) return { local, kpostId, mobile };
  }
  fail('mobkpost1..99 are all taken: earlier clean-ups failed; clear them first');
}

async function remove(db, kpostId, mobile) {
  if (!/^mobkpost\d{1,2}@kpostindia\.com$/.test(kpostId) || !/^90000009\d{2}$/.test(mobile))
    fail(`refusing to delete ${kpostId} / ${mobile}: not a mobkpost<N> throwaway account`);
  const removed = {};
  for (const [table, column, by] of FOOTPRINT) {
    const [result] = await db.query(`DELETE FROM ${table} WHERE ${column} = ?`, [
      by === 'id' ? kpostId : mobile,
    ]);
    if (result.affectedRows) removed[table] = result.affectedRows;
  }
  const [left] = await db.query(`SELECT kpost_id FROM ${USER_TABLE} WHERE kpost_id = ?`, [kpostId]);
  if (left.length) fail(`${kpostId} is still in ${USER_TABLE} after the clean-up`);
  return removed;
}

const [command, kpostId, mobile] = process.argv.slice(2);
const db = await connect();
try {
  if (command === 'pick') console.log(JSON.stringify(await pick(db)));
  else if (command === 'delete') console.log(JSON.stringify(await remove(db, kpostId, mobile)));
  else fail('usage: pick | delete <kpostId> <mobile>');
} finally {
  await db.end();
}
