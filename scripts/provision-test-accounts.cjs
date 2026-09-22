#!/usr/bin/env node
/* global fetch */
/**
 * Creates the bench's `qatest_*` accounts on the KPOST_QA test database.
 *
 * Run once, deliberately, with the repo owner's sign-off — it is not part of any test run.
 * **An account cannot be deleted through the KPost API**, so every row this writes is permanent on
 * the target. That is why it is a standalone script rather than a fixture.
 *
 * ## The signup sequence, and the one step that needs the database
 *
 *   1. `sendOTP`          mobile OTP — the test gateway delivers no SMS
 *   2. `validateOTP`      the `QA_BYPASS_OTP` bypass is accepted here
 *   3. `sendOTPtoMail`    e-mail OTP — **the mail server is live, so this really is sent**
 *   4. `validateMailOTP`  the bypass is NOT accepted here; the generated code is required
 *   5. `signup`           creates the account
 *
 * Step 4 is why this needs a database connection. The mobile bypass does not extend to e-mail, and
 * `TBL_KPOST_EMAIL_OTP_VALIDATION` holds the generated code beside the address, so on this test
 * database the real value can be read back. That shortcut is legitimate *here* and nowhere else:
 * it works only because the bench already has read access to KPOST_QA, and it is confined to
 * provisioning.
 *
 * ## Safety properties
 *
 * - **Idempotent.** An existing account is reported and left alone, never re-created.
 * - **Policy-checked.** Every id must satisfy the `qatest_` prefix and its type's domain before a
 *   single request is sent, so a typo cannot create an account the bench will not own.
 * - **Collision-checked.** Ids and mobile numbers are verified free first — reusing a real
 *   person's number would send them an OTP.
 * - **`provisioned: true` is only written after the account is proven to log in.**
 *
 * Usage: node scripts/provision-test-accounts.cjs [--only=<id>,<id>] [--dry-run]
 */
require('dotenv').config({ path: '.env', quiet: true });

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const mysql = require('mysql2/promise');

const REGISTRY = path.join(__dirname, '..', 'src', 'fixtures', 'test-accounts.json');
const BASE = String(process.env.KPOST_API_BASE_URL || '').replace(/\/$/, '');
const BYPASS = process.env.QA_BYPASS_OTP || '123456';
const COUNTRY = String(process.env.QA_COUNTRY_ID || 1);

/**
 * The password for the accounts this creates. Environment-only, with no fallback: a literal here
 * would sit in the repository for every future account, which is the exact rule the registry's
 * `passwordEnv` indirection exists to enforce.
 */
const PASSWORD = process.env.QATEST_SHARED_PASSWORD;

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const ONLY = (args.find((a) => a.startsWith('--only=')) || '').replace('--only=', '');

/** Mobile numbers reserved for the bench, verified free against the database before use. */
const MOBILES = {
  primary: '9626306841',
  counterparty: '9626306842',
  observer: '9626306843',
  'company-admin': '9626306844',
  'company-member': '9626306845',
  'company-expendable': '9626306846',
};

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
    /* non-JSON body — `text` still carries the message below */
  }
  const code = typeof parsed.statusCode === 'number' ? parsed.statusCode : response.status;
  // KPost answers HTTP 200 with statusCode 500 in the envelope, so the envelope is the truth.
  return {
    status: code,
    http: response.status,
    body: parsed,
    message: parsed.message || text.slice(0, 120),
  };
}

function resolveHost(value) {
  if (!value) return undefined;
  const authority =
    String(value)
      .replace(/^[a-z+]+:(?:\/\/)?/i, '')
      .split(/[/?]/)[0] || '';
  return (/^(\[[^\]]+\]|[^:]+)(?::\d+)?$/.exec(authority) || [])[1];
}

/** The most recent e-mail OTP for `email`, read from the test database. */
async function emailOtp(pool, email) {
  const [rows] = await pool.query(
    'SELECT `otp` FROM `TBL_KPOST_EMAIL_OTP_VALIDATION` WHERE `email` = ? ORDER BY `id` DESC LIMIT 1',
    [email],
  );
  return rows[0] && rows[0].otp;
}

async function accountExists(pool, kpostId) {
  const [rows] = await pool.query(
    'SELECT `kpost_id` FROM `TBL_KPOST_USER_MASTER` WHERE `kpost_id` = ? LIMIT 1',
    [kpostId],
  );
  return rows.length > 0;
}

async function mobileTaken(pool, mobile) {
  const [rows] = await pool.query(
    'SELECT `kpost_id` FROM `TBL_KPOST_USER_MASTER` WHERE `mobile_number` = ? LIMIT 1',
    [mobile],
  );
  return rows[0] && rows[0].kpost_id;
}

/** Proves the account is usable — the only thing that justifies marking it provisioned. */
async function canLogIn(kpostId, userType) {
  const login = await post('/v2/signupLogin/userLogin/', {
    ...DEVICE,
    sessionID: randomUUID(),
    kpostID: kpostId,
    loginRO: { countryID: COUNTRY, password: PASSWORD, userType },
    logintime: Date.now(),
  });
  return Boolean(login.body && login.body.accessToken);
}

async function provision(pool, account, mobile) {
  const email = `qa.bench+${account.id.replace(/-/g, '_')}@kpost.in`;

  if (await accountExists(pool, account.kpostId)) {
    const usable = await canLogIn(account.kpostId, account.userType);
    return { state: usable ? 'already-exists' : 'exists-but-login-failed' };
  }

  const owner = await mobileTaken(pool, mobile);
  if (owner) return { state: `mobile ${mobile} already belongs to ${owner} — not touching it` };

  if (DRY) return { state: 'would-create' };

  const sent = await post('/v2/common/sendOTP/', {
    countryID: COUNTRY,
    mobileNumber: mobile,
    requestType: 'signup',
  });
  if (sent.status !== 200) return { state: `sendOTP -> ${sent.status} ${sent.message}` };

  const validated = await post('/v2/common/validateOTP/', {
    otp: BYPASS,
    countryID: COUNTRY,
    mobileNumber: mobile,
  });
  if (validated.status !== 200) {
    return { state: `validateOTP -> ${validated.status} ${validated.message}` };
  }

  const mailSent = await post('/v2/common/sendOTPtoMail/', { otherEmail: email });
  if (mailSent.status !== 200) {
    return { state: `sendOTPtoMail -> ${mailSent.status} ${mailSent.message}` };
  }

  const code = await emailOtp(pool, email);
  if (!code) return { state: 'no e-mail OTP row appeared in the database' };

  const mailValidated = await post('/v2/common/validateMailOTP/', { email, otp: Number(code) });
  if (mailValidated.status !== 200) {
    return { state: `validateMailOTP -> ${mailValidated.status} ${mailValidated.message}` };
  }

  const created = await post('/v2/signupLogin/signup/', {
    kpostID: account.kpostId,
    firstName: 'QA',
    lastName: account.id.replace(/-/g, ' '),
    mobileNumber: mobile,
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
  if (created.status !== 200) return { state: `signup -> ${created.status} ${created.message}` };

  const usable = await canLogIn(account.kpostId, account.userType);
  return { state: usable ? 'created' : 'created-but-login-failed' };
}

(async () => {
  if (!PASSWORD) {
    throw new Error('QATEST_SHARED_PASSWORD is not set — refusing to create accounts without it');
  }

  const registry = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
  const policy = registry.domainPolicy;
  const identifier = new RegExp(policy.identifierPattern);

  const violation = (account) => {
    const at = account.kpostId.lastIndexOf('@');
    const local = account.kpostId.slice(0, at);
    const domain = account.kpostId.slice(at + 1).toLowerCase();
    if (!local.startsWith(policy.prefix)) return `missing "${policy.prefix}" prefix`;
    if (!identifier.test(local.slice(policy.prefix.length))) return 'bad identifier';
    if (domain !== policy[account.userType]) {
      return `${account.userType} must be on @${policy[account.userType]}, is on @${domain}`;
    }
    return undefined;
  };

  let targets = registry.accounts;
  if (ONLY) {
    const wanted = new Set(ONLY.split(','));
    targets = targets.filter((a) => wanted.has(a.id));
  }

  // Policy first: a typo must never reach the API.
  for (const account of targets) {
    const reason = violation(account);
    if (reason) throw new Error(`${account.id} (${account.kpostId}): ${reason}`);
  }

  const pool = mysql.createPool({
    host: resolveHost(process.env.DB_HOST),
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' },
    connectionLimit: 3,
    bigNumberStrings: true,
    multipleStatements: false,
  });

  console.log(`Provisioning ${targets.length} account(s) on ${BASE}${DRY ? ' (dry run)' : ''}\n`);
  const results = [];
  try {
    for (const account of targets) {
      const mobile = MOBILES[account.id];
      if (!mobile) {
        results.push([account, { state: 'no mobile number reserved for this id' }]);
        console.log(`  ${account.kpostId.padEnd(34)} no mobile reserved`);
        continue;
      }
      const result = await provision(pool, account, mobile);
      console.log(`  ${account.kpostId.padEnd(34)} ${result.state}`);
      results.push([account, result]);
    }
  } finally {
    await pool.end();
  }

  const live = results.filter(([, r]) => r.state === 'created' || r.state === 'already-exists');
  if (!DRY && live.length) {
    for (const [account] of live) {
      const entry = registry.accounts.find((a) => a.id === account.id);
      entry.provisioned = true;
      entry.provisionedAt = entry.provisionedAt || new Date().toISOString();
    }
    fs.writeFileSync(REGISTRY, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
    console.log(`\nRegistry updated: ${live.length} account(s) marked provisioned.`);
  }

  const failed = results.filter(
    ([, r]) => !['created', 'already-exists', 'would-create'].includes(r.state),
  );
  if (failed.length) console.log(`\n${failed.length} account(s) were not provisioned.`);
  process.exitCode = failed.length ? 1 : 0;
})().catch((error) => {
  console.error('provisioning failed:', error.message);
  process.exitCode = 1;
});
