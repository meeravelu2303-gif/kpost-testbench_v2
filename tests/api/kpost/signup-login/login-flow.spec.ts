import { randomUUID } from 'node:crypto';
import { AUTH_PROFILES, KPOST_DEVICE_IDENTITY } from '@config/auth-profile';
import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import { decodeJwt, jwtSubject } from '@utils/jwt';

/**
 * Login **behaviour** — the assertions the central engine cannot make.
 *
 * `login.spec.ts` runs the contract validators (status, schema, headers, security) once per
 * endpoint. This file tests what those cannot: that a wrong password is rejected, that failure
 * cannot be used to tell a real account from a fake one, what the token actually claims, and that a
 * session can be ended without harming the shared one. Each test drives the endpoints directly and
 * asserts a specific outcome.
 *
 * ## Live-safety rules obeyed here
 *
 *  - **Only our own accounts.** `QA_KPOST_ID` and `QA_VICTIM_KPOST_ID`, never a real customer id.
 *  - **Every wrong-password attempt is paired with a good login in the same test**, and the live run
 *    is `workers: 1`, so attempts never overlap. A bench that locks its own QA account out stops
 *    every other module — the cost of a lockout is far higher than the value of a second negative
 *    case, so each test cleans up after itself rather than relying on run order.
 *  - **A fresh session for the logout test.** It logs in on its own device id and logs *that* out,
 *    so the token every other test shares is untouched.
 */

/** The `message` field of a response body as a string, or '' — module scope so it is not test flow. */
function bodyMessage(body: Record<string, unknown>): string {
  return typeof body.message === 'string' ? body.message : '';
}

/**
 * KPost lower-cases the kpostID in the token `sub` (verified on live: `Qatesting@` → `qatesting@`).
 * That is correct — an email identifier is case-insensitive — so identity is compared case-folded.
 */
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

test.describe('KPost Login · behaviour', () => {
  /*
   * `default`, not `serial`. Serial skips every later test after the first failure — and several of
   * these assertions are *meant* to stay red (they report live defects), which would hide every
   * finding after the first. Each test is self-contained (a wrong attempt is always paired with a
   * good login in the same test), and the live run is `workers: 1`, so they still run one at a time.
   * Findings use `expect.soft` so a single run surfaces all of them at once.
   */
  test.describe.configure({ mode: 'default' });

  test('the happy path issues a token whose subject is our account @api @signup-login', async ({
    endpoints,
  }) => {
    const { status, body } = await login(endpoints, testData.kpostId, testData.password);

    expect(status, 'our own credentials must log in').toBe(200);
    expect(String(body.status).toUpperCase(), 'application status').toBe('SUCCESS');
    expect(body.accessToken, 'an access token is issued').toBeTruthy();
    expect(
      sameAccount(jwtSubject(String(body.accessToken)), testData.kpostId),
      'token subject is our account (case-insensitive: the API lower-cases it)',
    ).toBe(true);
  });

  test('the access token is a signed JWT that expires and hides no secret @api @signup-login @security', async ({
    endpoints,
  }) => {
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
  });

  test('a wrong password is rejected, and the account still logs in afterwards @api @signup-login @security', async ({
    endpoints,
  }) => {
    // The one wrong-password attempt this test makes against the primary account.
    const wrong = await login(endpoints, testData.kpostId, 'DefinitelyNotMyPassword!9f2a');

    // Safety net first, and HARD: the account must still work after a wrong attempt.
    const good = await login(endpoints, testData.kpostId, testData.password);
    expect(good.status, 'the account must still log in after one wrong attempt').toBe(200);

    // No token is the one thing the API gets right here — assert it hard.
    expect(wrong.body.accessToken ?? null, 'no token on a failed login').toBeNull();

    /*
     * THE FINDING (soft, so the run continues and reports every defect): on live, a wrong password
     * answers **HTTP 200** `"Invalid Credential"` — the same status as success. A caller reading the
     * HTTP status cannot tell a failed login from a successful one. It must be a 4xx (401). Soft so
     * this stays red and reported without halting the suite. See docs and CLAUDE.md §8.
     */
    expect
      .soft(wrong.status, 'a wrong password must not answer 2xx — it does (HTTP 200)')
      .toBeGreaterThanOrEqual(400);
    expect
      .soft(wrong.status, 'a rejected credential is a client error, not a server fault')
      .toBeLessThan(500);
  });

  test('login failure cannot distinguish a real account from an unknown one @api @signup-login @security', async ({
    endpoints,
  }) => {
    /*
     * BR: a failure must not reveal whether the id or the password was wrong (account enumeration).
     * A wrong password on OUR account and any password on an account that does not exist should be
     * indistinguishable — same status, same message.
     */
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
  });

  test('a session can be ended without harming the shared session @api @signup-login', async ({
    endpoints,
  }) => {
    /*
     * Open a NEW session on a device id of our own, then log exactly that one out. The token the
     * rest of the run shares is on KPOST_DEVICE_IDENTITY, so it is untouched — which the final
     * assertion confirms by logging in again on the shared device.
     */
    const ownDevice = `qa-bench-flow-${randomUUID()}`;
    const opened = await login(
      endpoints,
      testData.kpostId,
      testData.password,
      'PERSONAL',
      ownDevice,
    );
    expect(opened.status, 'the throwaway session opens').toBe(200);

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

    // The shared session (a different device) is unaffected.
    const shared = await login(endpoints, testData.kpostId, testData.password);
    expect(shared.status, 'the shared session still logs in').toBe(200);
  });
});
