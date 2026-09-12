import { AUTH_PROFILES } from '@config/auth-profile';
import { testData } from '@config/test-data.config';
import { USER_TYPES } from '@api/schemas/kpost-types';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import { jwtExpiry, jwtSubject } from '@utils/jwt';

/**
 * Login across **every KPost user type**.
 *
 * The centralized engine validates the login endpoint once, with one principal — the right design
 * for contract checks, but it cannot answer "does a Large business log in, and does it come back
 * as a Large business?". The user type is not a flag on an account here: KPost treats it as part
 * of the credential, so each tier is a distinct identity and each needs its own login.
 *
 * The four types, confirmed by the API owner:
 *
 *     PERSONAL      an individual
 *     BUSINESS_S    Small
 *     BUSINESS_M    Medium
 *     BUSINESS_L    Large
 *
 * Each tier below is a real account on the target host. The tiers differ in one externally visible
 * way that matters to the rest of the suite: a business login returns a `companyID`, a personal one
 * does not — which is what makes a business account able to administer a company at all.
 */
interface Tier {
  userType: string;
  kpostId: string;
  /** Businesses belong to a company; a personal account does not. */
  expectsCompany: boolean;
}

const TIERS: Tier[] = [
  { userType: 'PERSONAL', kpostId: testData.kpostId, expectsCompany: false },
  { userType: 'BUSINESS_S', kpostId: testData.businessSKpostId, expectsCompany: true },
  { userType: 'BUSINESS_M', kpostId: testData.businessMKpostId, expectsCompany: true },
  { userType: 'BUSINESS_L', kpostId: testData.businessLKpostId, expectsCompany: true },
];

interface LoginResponse {
  status?: string;
  statusCode?: number;
  accessToken?: string;
  refreshToken?: string;
  data?: { kpostID?: string; userType?: string; companyID?: number; mobileNumber?: string };
}

/**
 * One login per tier, reused by that tier's cases.
 *
 * Not an optimisation — a necessity. Concurrent logins of *different* accounts make this endpoint
 * answer 500 (reproduced below), so a spec that logged in once per assertion would be flaky for a
 * reason that has nothing to do with what each assertion is checking. The defect is pinned down in
 * its own test instead, where it is the subject rather than the noise.
 */
const logins = new Map<string, Promise<{ status: number; body: LoginResponse }>>();

function loginOnce(
  endpoints: EndpointExecutor,
  tier: Pick<Tier, 'userType' | 'kpostId'>,
  password = testData.password,
): Promise<{ status: number; body: LoginResponse }> {
  const key = `${tier.kpostId}|${tier.userType}|${password}`;
  let pending = logins.get(key);
  if (!pending) {
    pending = login(endpoints, tier, password);
    logins.set(key, pending);
  }
  return pending;
}

async function login(
  endpoints: EndpointExecutor,
  tier: Pick<Tier, 'userType' | 'kpostId'>,
  password = testData.password,
): Promise<{ status: number; body: LoginResponse }> {
  const spec = AUTH_PROFILES.kpost.loginRequest({
    key: `tier-${tier.userType}`,
    role: 'USER',
    username: tier.kpostId,
    password,
    userType: tier.userType,
  });
  // Sent without a token and without the engine's probes: this is the credential under test.
  const exchange = await endpoints.sendTo('signup-login-user-login', spec, {
    label: `login:${tier.userType}`,
    auth: { header: undefined },
  });
  const parsed = exchange.json();
  return { status: exchange.status, body: (parsed.ok ? parsed.value : {}) as LoginResponse };
}

test.describe('KPost Signup & Login · user types', () => {
  // One worker: the login cache above is per-process, and logins must not race (see below).
  test.describe.configure({ mode: 'default' });

  /**
   * The workbook's Types tab lists only the three business tiers - `PERSONAL` is absent from it,
   * even though it is the most common account type and the API returns it. A documentation gap, not
   * an API defect, so it is recorded as a named exception rather than a red test.
   *
   * The exception is asserted in both directions: if the Types tab gains PERSONAL, this test fails
   * and tells us to delete the exception, so the workaround cannot quietly outlive the gap.
   */
  const ABSENT_FROM_TYPES_TAB = ['PERSONAL'];

  test('every user type is either in the types contract or a known workbook gap @framework', () => {
    const contractTypes = USER_TYPES;

    for (const tier of TIERS) {
      if (ABSENT_FROM_TYPES_TAB.includes(tier.userType)) continue;
      expect(contractTypes, `${tier.userType} is in the types contract`).toContain(tier.userType);
    }

    const stillMissing = ABSENT_FROM_TYPES_TAB.filter((type) => !contractTypes.includes(type));
    expect(stillMissing, 'exceptions that the Types tab now documents - remove them here').toEqual(
      ABSENT_FROM_TYPES_TAB,
    );
  });

  for (const tier of TIERS) {
    test.describe(tier.userType, () => {
      test(`logs in and is identified as ${tier.userType} @api @signup-login`, async ({
        endpoints,
      }) => {
        const { status, body } = await loginOnce(endpoints, tier);

        expect(status, `${tier.kpostId} should log in`).toBe(200);
        expect(body.status?.toUpperCase(), 'application status').toBe('SUCCESS');
        // The account comes back as the type it was asked for - not silently downgraded.
        expect(body.data?.userType, 'userType echoed by the API').toBe(tier.userType);
        expect(body.data?.kpostID, 'account identity').toBe(tier.kpostId);
      });

      test(`issues a usable access token @api @signup-login`, async ({ endpoints }) => {
        const { body } = await loginOnce(endpoints, tier);

        expect(body.accessToken, 'accessToken present').toBeTruthy();
        expect(body.refreshToken, 'refreshToken present').toBeTruthy();
        // A token for the right subject, and one that expires: a JWT without an exp never dies.
        expect(jwtSubject(body.accessToken ?? ''), 'token subject').toBe(tier.kpostId);
        expect(jwtExpiry(body.accessToken ?? ''), 'token has an expiry').toBeTruthy();
      });

      test(`${tier.expectsCompany ? 'belongs to a company' : 'has no company'} @api @signup-login`, async ({
        endpoints,
      }) => {
        const { body } = await loginOnce(endpoints, tier);

        if (tier.expectsCompany) {
          expect(body.data?.companyID, 'business accounts administer a company').toBeTruthy();
        } else {
          expect(body.data?.companyID ?? null, 'a personal account has no company').toBeNull();
        }
      });

      test(`rejects the wrong password @api @signup-login @security`, async ({ endpoints }) => {
        const { status, body } = await loginOnce(endpoints, tier, 'DefinitelyNotThePassword!9f2a');

        expect(status, 'a wrong password must not authenticate').not.toBe(200);
        expect(body.accessToken ?? null, 'no token on a failed login').toBeNull();
        /*
         * The live API answers 500 "Invalid Credential" here. 500 is a server fault, and a wrong
         * password is the client's - so this asserts the correct contract (a 4xx) and will keep
         * failing until it is fixed. See CLAUDE.md §8 for why that is deliberate.
         */
        expect(status, 'a rejected credential is a client error, not a server fault').toBeLessThan(
          500,
        );
      });
    });
  }

  test('the tier is part of the credential: a business account cannot log in as PERSONAL @api @signup-login @security', async ({
    endpoints,
  }) => {
    /*
     * If the userType were merely descriptive, a Small business could log in by claiming PERSONAL
     * and land in a different permission model. It cannot - which is the behaviour worth pinning
     * down, because it is what makes tier-scoped authorization meaningful.
     */
    const { status, body } = await loginOnce(endpoints, {
      userType: 'PERSONAL',
      kpostId: testData.businessSKpostId,
    });

    expect(status, 'the wrong tier must not authenticate').not.toBe(200);
    expect(body.accessToken ?? null, 'no token for a mismatched tier').toBeNull();
  });

  test('every tier is a distinct identity with its own token @api @signup-login', async ({
    endpoints,
  }) => {
    const subjects = new Map<string, string>();
    for (const tier of TIERS) {
      const { body } = await loginOnce(endpoints, tier);
      subjects.set(tier.userType, jwtSubject(body.accessToken ?? '') ?? '');
    }
    // Four accounts, four subjects: no tier is silently sharing another's session.
    const summary = [...subjects].map(([type, subject]) => `${type}=${subject}`).join(', ');
    expect(new Set(subjects.values()).size, `distinct token subjects: ${summary}`).toBe(
      TIERS.length,
    );
  });
});

test.describe('KPost Signup & Login · concurrent logins', () => {
  test('four user types can log in at the same time @api @signup-login @concurrency', async ({
    endpoints,
  }) => {
    /*
     * Four DIFFERENT accounts logging in simultaneously. Sequentially all four succeed; run
     * together, one or two answer
     *
     *     500 "The request could not be completed due to an internal error. Quote the traceId…"
     *
     * reproducibly (three rounds by hand: 2, 1 and 1 failures out of 4). Two concurrent logins of
     * the *same* account both succeed, so this is not a one-session-per-account rule — it looks
     * like shared mutable state in the login path.
     *
     * It matters because it is exactly the real access pattern: an office of people signing in at
     * nine o'clock. This test asserts the behaviour KPost should have and stays red until it does.
     */
    const results = await Promise.all(
      TIERS.map(async (tier) => ({
        userType: tier.userType,
        ...(await login(endpoints, tier)),
      })),
    );

    const failed = results.filter((result) => result.status !== 200);
    expect(
      failed.map((result) => `${result.userType}=${result.status}`),
      'no login should fail because another account logged in at the same moment',
    ).toEqual([]);
  });
});
