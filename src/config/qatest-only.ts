import accounts from '../fixtures/test-accounts.json';

/**
 * `QATEST_ONLY=true` re-points the PERSONAL `QA_*` accounts at the dedicated qatest1..6 accounts (1
 * primary, 2 counterparty, 3-4 group, 5 write target, 6 forgot-password spare). Business accounts
 * are kept with their own password; personal-6 is removed.
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

/** Older PERSONAL-only values with no qatest equivalent. Business values are deliberately NOT here. */
const REMOVED = ['QA_PERSONAL_6_KPOST_ID'] as const;

/** The business-tier variables that must survive the switch. */
export const KEPT_BUSINESS = [
  'QA_BUSINESS_S_KPOST_ID',
  'QA_BUSINESS_M_KPOST_ID',
  'QA_BUSINESS_L_KPOST_ID',
  'QA_BUSINESS_RECEIVER_KPOST_ID',
  'QA_BUSINESS_M_USER_1_KPOST_ID',
  'QA_BUSINESS_M_USER_2_KPOST_ID',
  'QA_BUSINESS_M_USER_3_KPOST_ID',
  'QA_BUSINESS_M_USER_4_KPOST_ID',
  'QA_BUSINESS_M_MOBILE',
  'QA_COMPANY_ID',
  'QA_COMPANY_NAME',
  'QA_BUSINESS_S_COMPANY_ID',
  'QA_BUSINESS_M_COMPANY_ID',
  'QA_BUSINESS_L_COMPANY_ID',
  'QA_ADMIN_KPOST_ID',
  'QA_ADMIN_PASSWORD',
] as const;

function account(id: string): { kpostIdEnv: string; mobile?: string } {
  const found = accounts.accounts.find((entry) => entry.id === id);
  if (!found) throw new Error(`QATEST_ONLY: ${id} is not in src/fixtures/test-accounts.json`);
  return found;
}

/**
 * The environment values to apply (`undefined` removes one); throws when a qatest account is not
 * configured.
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
  // Capture the business password before QA_PASSWORD is re-pointed, unless it was set explicitly.
  if (!source.QA_BUSINESS_PASSWORD && source.QA_PASSWORD) {
    out.QA_BUSINESS_PASSWORD = source.QA_PASSWORD;
  }
  out.QA_PASSWORD = password;
  const mobile = account('qatest1').mobile;
  if (mobile) out.QA_MOBILE_EXISTS = mobile;
  for (const variable of REMOVED) out[variable] = undefined;
  return out;
}

/** Applies `qatestOnlyOverrides` to the process environment when `QATEST_ONLY=true`. */
export function applyQatestOnly(target: Env = process.env): boolean {
  if (target.QATEST_ONLY !== 'true') return false;
  for (const [variable, value] of Object.entries(qatestOnlyOverrides(target))) {
    if (value === undefined) delete target[variable];
    else target[variable] = value;
  }
  return true;
}
