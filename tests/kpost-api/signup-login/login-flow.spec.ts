import { randomUUID } from 'node:crypto';
import { AUTH_PROFILES, KPOST_DEVICE_IDENTITY } from '@config/auth-profile';
import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import { decodeJwt, jwtSubject } from '@utils/jwt';

/**
 * Login behaviour the engine cannot check: wrong password, account enumeration, token claims, logout.
 * Every wrong-password attempt is followed by a good login, and logout uses its own device session
 * so the shared token is untouched.
 */

/** The `message` field of a response body as a string, or '' — module scope so it is not test flow. */
function bodyMessage(body: Record<string, unknown>): string {
  return typeof body.message === 'string' ? body.message : '';
}

/** KPost lower-cases the kpostID in the token `sub`, so identity is compared case-folded. */
function sameAccount(a: string | undefined, b: string): boolean {
  return (a ?? '').toLowerCase() === b.toLowerCase();
}

/** A login exchange sent WITHOUT the engine's cached token — this is the credential under test. */
async function login(
  endpoints: EndpointExecutor,
  kpostId: string,
  password: string,
  userType = 'PERSONAL',
  device = KPOST_DEVICE_IDENTITY,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const base = AUTH_PROFILES.kpost.loginRequest({
    key: 'flow',
    role: 'USER',
    username: kpostId,
    password,
    userType,
  });
  const spec = {
    body: {
      ...(base.body as Record<string, unknown>),
      sessionID: randomUUID(),
      deviceIdentity_primary: device,
    },
  };
  const exchange = await endpoints.sendTo('signup-login-user-login', spec, {
    label: `login-flow:${kpostId}`,
    auth: { header: undefined },
  });
  const parsed = exchange.json();
  return {
    status: exchange.status,
    body: (parsed.ok ? parsed.value : {}) as Record<string, unknown>,
  };
}

test.describe('KPost Login · behaviour', { tag: ['@api', '@auth', '@regression'] }, () => {
  // Not `serial`: one failing finding must not skip the tests after it. Each test is self-contained.
  test.describe.configure({ mode: 'default' });

  test(
    'the happy path issues a token whose subject is our account @api @signup-login',
    { tag: '@sanity', annotation: [{ type: 'requirement', description: 'FR-SL-026' }] },
    async ({ endpoints }) => {
      const { status, body } = await login(endpoints, testData.kpostId, testData.password);

      expect(status, 'our own credentials must log in').toBe(200);
      expect(String(body.status).toUpperCase(), 'application status').toBe('SUCCESS');
      expect(body.accessToken, 'an access token is issued').toBeTruthy();
      expect(
        sameAccount(jwtSubject(String(body.accessToken)), testData.kpostId),
        'token subject is our account (case-insensitive: the API lower-cases it)',
      ).toBe(true);
    },
  );

  test(
    'the access token is a signed JWT that expires and hides no secret @api @signup-login @security',
    { annotation: [{ type: 'requirement', description: 'BR-SL-JWT' }] },
    async ({ endpoints }) => {
      const { body } = await login(endpoints, testData.kpostId, testData.password);
      const decoded = decodeJwt(String(body.accessToken));

      expect(decoded, 'a well-formed JWT').toBeTruthy();
      expect(decoded?.signature, 'it is signed — not alg:none').toBeTruthy();
      expect(decoded?.payload.exp, 'it expires — a token without exp never dies').toBeTruthy();
      // The claims must not carry the password or anything password-shaped.
      const claims = JSON.stringify(decoded?.payload ?? {}).toLowerCase();
      expect(claims, 'no password in the token claims').not.toContain(
        testData.password.toLowerCase(),
      );
    },
  );

  test('a wrong password is rejected, and the account still logs in afterwards @api @signup-login @security', async ({
    endpoints,
  }) => {
    // Wrong passwords go to a dedicated throwaway account so a lockout never hits the primary.
    const negConfigured =
      testData.negLoginKpostId &&
      !testData.negLoginKpostId.includes('qa.neg') &&
      testData.negLoginPassword.length > 0;
    test.skip(
      !negConfigured,
      'set QA_NEG_KPOST_ID + QA_NEG_PASSWORD to a dedicated throwaway account so wrong-password attempts never lock the primary QATEST account',
    );

    // The one wrong-password attempt this test makes — against the DEDICATED account.
    const wrong = await login(endpoints, testData.negLoginKpostId, 'DefinitelyNotMyPassword!9f2a');

    // Safety net first, and HARD: the account must still work after a wrong attempt.
    const good = await login(endpoints, testData.negLoginKpostId, testData.negLoginPassword);
    expect(good.status, 'the account must still log in after one wrong attempt').toBe(200);

    // No token is the one thing the API gets right here — assert it hard.
    expect(wrong.body.accessToken ?? null, 'no token on a failed login').toBeNull();

    // Known defect: a wrong password answers HTTP 200 "Invalid Credential"; it must be a 4xx.
    expect
      .soft(wrong.status, 'a wrong password must not answer 2xx — it does (HTTP 200)')
      .toBeGreaterThanOrEqual(400);
    expect
      .soft(wrong.status, 'a rejected credential is a client error, not a server fault')
      .toBeLessThan(500);
  });

  test(
    'login failure cannot distinguish a real account from an unknown one @api @signup-login @security',
    { annotation: [{ type: 'requirement', description: 'BR-SL-ENUM' }] },
    async ({ endpoints }) => {
      // A wrong password on a real account and an unknown account must look identical.
      const realButWrong = await login(endpoints, testData.kpostId, 'WrongPassword!9f2a');
      const doesNotExist = await login(endpoints, testData.kpostIdAbsent, 'WrongPassword!9f2a');

      // Soft: a difference here is a finding (login reveals which accounts exist), not a reason to halt.
      expect
        .soft(realButWrong.status, 'same status for a real vs unknown account')
        .toBe(doesNotExist.status);
      expect
        .soft(
          bodyMessage(realButWrong.body),
          'same message, so the response cannot confirm an account exists',
        )
        .toBe(bodyMessage(doesNotExist.body));
    },
  );

  test(
    'a session can be ended without harming the shared session @api @signup-login @database',
    { tag: '@sanity' },
    async ({ endpoints, databases }) => {
      // Log out a fresh session on our own device id; the shared token (KPOST_DEVICE_IDENTITY) is untouched.
      const ownDevice = `qa-bench-flow-${randomUUID()}`;
      const opened = await login(
        endpoints,
        testData.kpostId,
        testData.password,
        'PERSONAL',
        ownDevice,
      );
      expect(opened.status, 'the throwaway session opens').toBe(200);

      const database = databases.for('kpost-api');
      if (database.enabled) {
        const row = await database.findOne<{ device_identity_primary: string }>({
          table: 'TBL_KPOST_LOGIN_SESSION',
          where: { kpost_id: testData.kpostId, device_identity_primary: ownDevice },
        });
        expect(row, 'the fresh login wrote a row to TBL_KPOST_LOGIN_SESSION').toBeDefined();
      }

      const logout = await endpoints.sendTo(
        'signup-login-user-logout',
        {
          body: {
            deviceType: 'Web',
            deviceIdentity_primary: ownDevice,
            logouttime: new Date().toISOString().replace('T', ' ').slice(0, 19),
          },
        },
        {
          label: 'login-flow:logout-own',
          // Authenticate as the session we just opened, by its own token.
          auth: { header: `Bearer ${String(opened.body.accessToken)}` },
        },
      );
      expect(logout.status, 'logout of our own session succeeds').toBeLessThan(400);

      // Logout answers success regardless, so the row is the judge.
      if (database.enabled) {
        const afterLogout = await database.findOne<{ device_identity_primary: string }>({
          table: 'TBL_KPOST_LOGIN_SESSION',
          where: { kpost_id: testData.kpostId, device_identity_primary: ownDevice },
        });
        expect(
          afterLogout,
          'logout actually removed the session row, not just answered success',
        ).toBeUndefined();
      }

      // BR-SL-LOGOUT: a deleted row is not enough; the logged-out JWT itself must stop authenticating.
      const reuseAttempt = await endpoints.sendTo(
        'signup-login-active-session',
        {},
        {
          label: 'login-flow:logout-token-reuse',
          auth: { header: `Bearer ${String(opened.body.accessToken)}` },
        },
      );
      expect
        .soft(
          reuseAttempt.status,
          `BR-SL-LOGOUT: a logged-out token must not still authenticate (getActiveSession replied ${reuseAttempt.status})`,
        )
        .toBe(401);

      // The shared session (a different device) is unaffected.
      const shared = await login(endpoints, testData.kpostId, testData.password);
      expect(shared.status, 'the shared session still logs in').toBe(200);
    },
  );

  test(
    'mobile and the full domain-qualified ID log in; the bare KPost ID is correctly rejected (BR-SL-3IDS) @api @signup-login',
    { annotation: [{ type: 'requirement', description: 'BR-SL-3IDS' }] },
    async ({ endpoints }) => {
      // Mobile or the full ID log in; the bare local part is ambiguous across domains, so it is
      // refused. The primary account's mobile is hardcoded: `QA_MOBILE_EXISTS` is another account's.
      const bareId = testData.kpostId.split('@')[0] ?? testData.kpostId;
      const primaryMobile = '8122016145';

      const validForms: Array<[string, string]> = [
        ['full domain-qualified ID', testData.kpostId],
        ['mobile number', primaryMobile],
      ];

      for (const [label, identifier] of validForms) {
        const { status, body } = await login(endpoints, identifier, testData.password);
        expect
          .soft(status, `BR-SL-3IDS: login via ${label} ("${identifier}") must succeed`)
          .toBe(200);
        // Evaluated unconditionally: a failed login is a failed case, not a skip.
        const token = typeof body.accessToken === 'string' ? body.accessToken : '';
        expect
          .soft(
            sameAccount(jwtSubject(token), testData.kpostId),
            `BR-SL-3IDS: login via ${label} must resolve to the SAME account as the full ID (status ${status})`,
          )
          .toBe(true);
      }

      const bare = await login(endpoints, bareId, testData.password);
      expect
        .soft(
          bare.status,
          `BR-SL-3IDS: login via the bare KPost ID ("${bareId}", no domain) must be rejected — ` +
            `the local part is not unique across domains, so this is correct, not a bug (status ${bare.status})`,
        )
        .toBe(401);
    },
  );
});
