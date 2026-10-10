import accounts from '../fixtures/test-accounts.json';

/**
 * `QATEST_ONLY=true` runs the bench on the dedicated qatest1..6 accounts and nothing else.
 *
 * The older QA accounts (QA_KPOST_ID, QA_VICTIM_KPOST_ID, the business tiers ...) are shared with
 * developers who are logging in and fixing bugs, so a run on them can lose its session, trip the
 * rate limiter, or fail on data someone else just changed. The qatest accounts are ours alone.
 *
 * The bench reads its accounts from the `QA_*` variables, so this re-points those at the qatest
 * accounts rather than touching every spec. Roles:
 *
 *     QA_KPOST_ID              <- qatest1   primary / record owner
 *     QA_VICTIM_KPOST_ID       <- qatest2   counterparty / stranger
 *     QA_PERSONAL_3/4_KPOST_ID <- qatest3/4 group and Cc parties
 *     QA_PERSONAL_5_KPOST_ID   <- qatest5   sacrificial write target (see api/sweep-target.ts)
 *     QA_FORGOT_PASSWORD_...   <- qatest6   spare: forgot-password and lockout probes
 *
 * Everything the qatest accounts cannot stand in for is removed, not left on its old value: the
 * business tiers and company ids (the qatest accounts are all PERSONAL) and personal-6. An unset
 * account has no principal, so the checks that need it skip with that reason, and its id never
 * enters the QA-identifier allowlist.
 */

type Env = Record<string, string | undefined>;

const ROLE_TO_QATEST: Readonly<Record<string, string>> = {
  QA_KPOST_ID: 'qatest1',
  QA_VICTIM_KPOST_ID: 'qatest2',
  QA_PERSONAL_3_KPOST_ID: 'qatest3',
  QA_PERSONAL_4_KPOST_ID: 'qatest4',
  QA_PERSONAL_5_KPOST_ID: 'qatest5',
  QA_FORGOT_PASSWORD_KPOST_ID: 'qatest6',
};

/** Older-account and business values with no qatest equivalent. */
const REMOVED = [
  'QA_PERSONAL_6_KPOST_ID',
  'QA_ADMIN_KPOST_ID',
  'QA_ADMIN_PASSWORD',
  'QA_BUSINESS_S_KPOST_ID',
  'QA_BUSINESS_M_KPOST_ID',
  'QA_BUSINESS_L_KPOST_ID',
  'QA_BUSINESS_RECEIVER_KPOST_ID',
  'QA_BUSINESS_M_USER_1_KPOST_ID',
  'QA_BUSINESS_M_USER_2_KPOST_ID',
  'QA_BUSINESS_M_USER_3_KPOST_ID',
  'QA_BUSINESS_M_USER_4_KPOST_ID',
  'QA_BUSINESS_M_MOBILE',
  'QA_BUSINESS_M_USER_1_MOBILE',
  'QA_BUSINESS_M_USER_2_MOBILE',
  'QA_BUSINESS_M_USER_3_MOBILE',
  'QA_BUSINESS_M_USER_4_MOBILE',
  'QA_COMPANY_ID',
  'QA_COMPANY_NAME',
  'QA_BUSINESS_S_COMPANY_ID',
  'QA_BUSINESS_M_COMPANY_ID',
  'QA_BUSINESS_L_COMPANY_ID',
] as const;

function account(id: string): { kpostIdEnv: string; mobile?: string } {
  const found = accounts.accounts.find((entry) => entry.id === id);
  if (!found) throw new Error(`QATEST_ONLY: ${id} is not in src/fixtures/test-accounts.json`);
  return found;
}

/**
 * The environment values to apply. A `string` sets the variable, `undefined` removes it.
 * Throws when a qatest account is not configured: falling back to an older account would defeat
 * the point of the switch.
 */
export function qatestOnlyOverrides(source: Env): Env {
  const out: Env = {};
  for (const [variable, id] of Object.entries(ROLE_TO_QATEST)) {
    const { kpostIdEnv } = account(id);
    const kpostId = source[kpostIdEnv];
    if (!kpostId) throw new Error(`QATEST_ONLY needs ${kpostIdEnv} (the ${id} account) in .env`);
    out[variable] = kpostId;
  }
  const password = source.QATEST_SHARED_PASSWORD;
  if (!password) throw new Error('QATEST_ONLY needs QATEST_SHARED_PASSWORD in .env');
  out.QA_PASSWORD = password;
  const mobile = account('qatest1').mobile;
  if (mobile) out.QA_MOBILE_EXISTS = mobile;
  for (const variable of REMOVED) out[variable] = undefined;
  return out;
}

/**
 * Applies `qatestOnlyOverrides` to the process environment when `QATEST_ONLY=true`.
 *
 * A no-op under `MOCK_API=true`: the qatest accounts are real identities on the live
 * application, meaningless against the bundled in-memory mock, whose fixtures expect the
 * schema's own default ids. A script that sets both flags together is a mistake, not a request —
 * see `npm run mock`, which does not (and must not) set QATEST_ONLY.
 */
export function applyQatestOnly(target: Env = process.env): boolean {
  if (target.QATEST_ONLY !== 'true' || target.MOCK_API === 'true') return false;
  for (const [variable, value] of Object.entries(qatestOnlyOverrides(target))) {
    if (value === undefined) delete target[variable];
    else target[variable] = value;
  }
  return true;
}
