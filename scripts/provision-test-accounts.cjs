#!/usr/bin/env node
/* global fetch */
/**
 * Creates the bench's `qatestN@<domain>` accounts on the KPost test environment, through the product's
 * own signup API, and records each one in `src/fixtures/test-accounts.json` as it is proven usable.
 *
 * Run deliberately, with the owner's sign-off: **an account cannot be deleted through the KPost API**,
 * so every row this creates is permanent.
 *
 * ## Why signup needs a human or the database
 *
 * The mobile OTP is a test gateway (the code `QA_BYPASS_OTP` always validates and no SMS is sent). The
 * e-mail OTP is NOT: the backend generates a real code, stores it, and sends it. It can only be read
 * from the mailbox it was sent to, or from `TBL_KPOST_EMAIL_OTP_VALIDATION` when the database is
 * reachable from this machine. So signup is two phases:
 *
 *   node scripts/provision-test-accounts.cjs                         status of every account (read-only)
 *   node scripts/provision-test-accounts.cjs --send                  phase 1: mobile OTP + send the e-mail OTP
 *   node scripts/provision-test-accounts.cjs --finish --from-db      phase 2: read the codes from the database
 *   node scripts/provision-test-accounts.cjs --finish --codes=qatest1:123456,qatest2:654321
 *
 * Add `--only=qatest1,qatest2` to limit either phase. The e-mail codes expire after about 10 minutes,
 * so run phase 2 soon after phase 1.
 *
 * ## Safety
 *
 * - Idempotent: an existing account is reported and left alone; the registry is only marked
 *   `provisioned` after the new account has logged in successfully.
 * - Every id and mobile is checked free through the product (`kpostIdExist`, `mobileNoExist`) first.
 * - The e-mail address that receives the codes comes from `QATEST_OTP_MAILBOX_TEMPLATE` (for example
 *   `qa.bench+{id}@kpost.in`); there is deliberately no default, so a code is never sent to a mailbox
 *   nobody reads. The password comes from `QATEST_SHARED_PASSWORD` only.
 */
require('dotenv').config({ path: '.env', quiet: true });

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const REGISTRY = path.join(__dirname, '..', 'src', 'fixtures', 'test-accounts.json');
const BASE = String(process.env.KPOST_API_BASE_URL || '').replace(/\/$/, '');
const BYPASS = process.env.QA_BYPASS_OTP || '123456';
const COUNTRY = String(process.env.QA_COUNTRY_ID || 1);
const PASSWORD = process.env.QATEST_SHARED_PASSWORD;
const MAILBOX = process.env.QATEST_OTP_MAILBOX_TEMPLATE;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => (args.find((a) => a.startsWith(`${name}=`)) || '').slice(name.length + 1);
const ONLY = option('--only');
const CODES = Object.fromEntries(
  option('--codes')
    .split(',')
    .filter(Boolean)
    .map((pair) => pair.split(':')),
);

const DEVICE = {
  deviceType: 'Web',
  deviceIdentity_primary: '9f9d6bd8-238f-11ed-b3e2-73ce62ed0e94',
  deviceIdentity_secondary: 'Desktop-Chrome',
  login_lattitude: 13.0476875,
  login_longitude: 80.2655737,
  oneSignal_Key: 'qa-bench',
  voip: 'voip',
  module: 0,
};

async function post(pathname, body) {
  const response = await fetch(BASE + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    /* non-JSON body: `text` still carries the message */
  }
  // KPost can answer HTTP 200 with statusCode 500 in the envelope, so the envelope is the truth.
  const code = typeof parsed.statusCode === 'number' ? parsed.statusCode : response.status;
  return { code, body: parsed, message: String(parsed.message || text).slice(0, 120) };
}

const idOf = (account) => process.env[account.kpostIdEnv];
const mailOf = (account) => MAILBOX.replace('{id}', account.id);

async function isFree(account) {
  const idCheck = await post('/v2/signupLogin/kpostIdExist/', {
    kpostID: idOf(account),
    firstName: 'QA',
    lastName: 'Test',
    mobileNumber: account.mobile,
  });
  const mobileCheck = await post('/v2/common/mobileNoExist/', {
    mobileNumber: account.mobile,
    countryID: COUNTRY,
  });
  return {
    id: /available/i.test(idCheck.message),
    mobile: /can be used/i.test(mobileCheck.message),
    detail: `id: ${idCheck.message} | mobile: ${mobileCheck.message}`,
  };
}

async function canLogIn(account) {
  const login = await post('/v2/signupLogin/userLogin/', {
    ...DEVICE,
    sessionID: randomUUID(),
    kpostID: idOf(account),
    loginRO: { countryID: COUNTRY, password: PASSWORD, userType: account.userType },
    logintime: Date.now(),
  });
  return Boolean(login.body && login.body.accessToken);
}

async function emailCodeFromDb(email) {
  // Only works when the DB host allows this machine's IP.
  const mysql = require('mysql2/promise');
  const [host, hostPort] = String(process.env.DB_HOST).split(':');
  const pool = mysql.createPool({
    host,
    port: Number(hostPort || process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' },
    connectTimeout: 8000,
    connectionLimit: 1,
  });
  try {
    const [rows] = await pool.query(
      'SELECT `otp` FROM `TBL_KPOST_EMAIL_OTP_VALIDATION` WHERE `email` = ? ORDER BY `id` DESC LIMIT 1',
      [email],
    );
    return rows[0] && String(rows[0].otp);
  } finally {
    await pool.end();
  }
}

async function send(account) {
  const free = await isFree(account);
  if (!free.id || !free.mobile) return `not free (${free.detail})`;
  const sent = await post('/v2/common/sendOTP/', {
    countryID: COUNTRY,
    mobileNumber: account.mobile,
    requestType: 'signup',
  });
  if (sent.code !== 200) return `sendOTP -> ${sent.code} ${sent.message}`;
  const validated = await post('/v2/common/validateOTP/', {
    otp: BYPASS,
    countryID: COUNTRY,
    mobileNumber: account.mobile,
  });
  if (validated.code !== 200) return `validateOTP -> ${validated.code} ${validated.message}`;
  const mail = await post('/v2/common/sendOTPtoMail/', { otherEmail: mailOf(account) });
  if (mail.code !== 200) return `sendOTPtoMail -> ${mail.code} ${mail.message}`;
  return `e-mail OTP sent to ${mailOf(account)}`;
}

async function finish(account, code) {
  const email = mailOf(account);
  const checked = await post('/v2/common/validateMailOTP/', { email, otp: Number(code) });
  if (checked.code !== 200) return `validateMailOTP -> ${checked.code} ${checked.message}`;
  const created = await post('/v2/signupLogin/signup/', {
    kpostID: idOf(account),
    firstName: account.id,
    lastName: 'Bench',
    mobileNumber: account.mobile,
    createdDate: Date.now(),
    password: PASSWORD,
    gender: 'female',
    dateOfBirth: '1995-01-01',
    module: 0,
    countryCode: '91',
    email,
    userProfile: {
      landLineNumber: '04400000000',
      referalId: '',
      pinCode: process.env.QA_PINCODE || '600001',
      areaName: 'Pazhavanthangal',
      state: 'Tamil Nadu',
      city: 'Chennai',
    },
  });
  if (created.code !== 200) return `signup -> ${created.code} ${created.message}`;
  return (await canLogIn(account)) ? 'created' : 'created-but-login-failed';
}

(async () => {
  const registry = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
  const wanted = ONLY ? new Set(ONLY.split(',')) : undefined;
  const targets = registry.accounts.filter(
    (a) => a.mobile && !a.provisioned && (!wanted || wanted.has(a.id)),
  );
  if (!targets.length) {
    console.log('Nothing to do: every account with a reserved mobile is provisioned.');
    return;
  }

  for (const account of targets) {
    if (!idOf(account))
      throw new Error(`${account.kpostIdEnv} is not set in .env (account ${account.id})`);
  }

  const phase = flag('--send') ? 'send' : flag('--finish') ? 'finish' : 'status';
  if (phase !== 'status' && !PASSWORD) throw new Error('QATEST_SHARED_PASSWORD is not set');
  if (phase !== 'status' && !MAILBOX) {
    throw new Error('QATEST_OTP_MAILBOX_TEMPLATE is not set (e.g. qa.bench+{id}@kpost.in)');
  }

  console.log(`${phase}: ${targets.length} account(s) on ${BASE}\n`);
  let created = 0;
  for (const account of targets) {
    const label = `${idOf(account)} (${account.mobile})`.padEnd(46);
    let result;
    if (phase === 'status') {
      const free = await isFree(account);
      result = free.id && free.mobile ? 'free, ready to create' : `NOT free: ${free.detail}`;
    } else if (phase === 'send') {
      result = await send(account);
    } else {
      let code = CODES[account.id];
      if (!code && flag('--from-db')) {
        try {
          code = await emailCodeFromDb(mailOf(account));
        } catch (error) {
          result = `database not reachable (${error.code || error.message}); pass --codes instead`;
        }
      }
      result = result || (code ? await finish(account, code) : 'no code supplied');
      if (result === 'created') {
        const entry = registry.accounts.find((a) => a.id === account.id);
        entry.provisioned = true;
        entry.provisionedAt = new Date().toISOString();
        fs.writeFileSync(REGISTRY, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
        created += 1;
      }
    }
    console.log(`  ${label} ${result}`);
  }
  if (phase === 'finish')
    console.log(`\n${created} account(s) created and recorded in the registry.`);
})().catch((error) => {
  console.error('provisioning failed:', error.message);
  process.exitCode = 1;
});
