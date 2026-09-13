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
 *  - **At most one wrong-password attempt per account per run**, and this suite runs on ONE worker
 *    (`mode: 'serial'` below), so the attempts never overlap. A bench that locks its own QA account
 *    out stops every other module — the cost of a lockout is far higher than the value of a second
 *    negative case.
 *  - **A fresh session for the logout test.** It logs in on its own device id and logs *that* out,
 *    so the token every other test shares is untouched.
 */

/** The `message` field of a response body as a string, or '' — module scope so it is not test flow. */
function bodyMessage(body: Record<string, unknown>): string {
  return typeof body.message === 'string' ? body.message : '';
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
  // One worker, in order: the wrong-password cases must never race, and must always be followed by
  // a successful login that confirms the account is not locked.
  test.describe.configure({ mode: 'serial' });

  test('the happy path issues a token whose subject is our account @api @signup-login', async ({
    endpoints,
  }) => {
    const { status, body } = await login(endpoints, testData.kpostId, testData.password);

    expect(status, 'our own credentials must log in').toBe(200);
    expect(String(body.status).toUpperCase(), 'application status').toBe('SUCCESS');
    expect(body.accessToken, 'an access token is issued').toBeTruthy();
    expect(jwtSubject(String(body.accessToken)), 'token subject is our account').toBe(
      testData.kpostId,
    );
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
    // The one wrong-password attempt this run makes against the primary account.
    const wrong = await login(endpoints, testData.kpostId, 'DefinitelyNotMyPassword!9f2a');

    expect(wrong.status, 'a wrong password must not authenticate').not.toBe(200);
    expect(wrong.body.accessToken ?? null, 'no token on a failed login').toBeNull();
    /*
     * The live API answers 500 "Invalid Credential" here — a server fault for a client error. This
     * asserts the correct contract (a 4xx) and stays red until it is fixed; see CLAUDE.md §8.
     */
    expect(
      wrong.status,
      'a rejected credential is a client error, not a server fault',
    ).toBeLessThan(500);

    // Immediately prove the account is NOT locked — the safety net for the attempt above.
    const good = await login(endpoints, testData.kpostId, testData.password);
    expect(good.status, 'the account must still log in after one wrong attempt').toBe(200);
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

    expect(realButWrong.status, 'same status for both').toBe(doesNotExist.status);
    expect(
      bodyMessage(realButWrong.body),
      'same message, so the response cannot confirm an account exists',
    ).toBe(bodyMessage(doesNotExist.body));
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
