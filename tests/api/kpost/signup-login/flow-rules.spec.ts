import { AUTH_PROFILES } from '@config/auth-profile';
import { testData } from '@config/test-data.config';
import { env } from '@config/env';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';

/**
 * The rules the **documents** require, which no schema can express.
 *
 * Everything else in this module tests the contract: status, shape, types, auth. These test the
 * product's own rules as written in `KPOST_FullSuite_FRD.docx` v2.0 and the SRS — the things a
 * reader of the requirements would expect to be true, and which nothing in the workbook mentions:
 *
 *   BR-S01   Activation is mandatory. "Login before activation must fail."
 *   BR-S02   An existing identifier is rejected **at submission**, not deferred to activation.
 *   FR-S03   The signup form checks availability before it submits.
 *   NFR-SEC  A login failure must not reveal whether the identifier exists (account enumeration).
 *
 * ## The gap these tests exist to expose
 *
 * **There is no activation endpoint.** The contract documents 356 endpoints, and a search for
 * activation finds only `deactivateAccount` and `sendAccountDeactivationOtp` — the reverse. So
 * either activation happens outside the API (an emailed link), or the workbook is missing it, or
 * signup activates immediately and BR-S01 is not implemented. Those have very different
 * consequences, and a bench that stays silent about it is no help: the test below answers the
 * question empirically by registering an account and immediately trying to log in.
 */
interface SignupResponse {
  status?: string;
  statusCode?: number;
  message?: string;
  kpostID?: string;
  mobileNumber?: string;
}

interface LoginResponse {
  status?: string;
  statusCode?: number;
  message?: string;
  accessToken?: string;
}

/** A fresh identity, in the reserved QA ranges so it can never collide with a real customer. */
function freshIdentity(): { kpostID: string; mobileNumber: string; password: string } {
  const unique = Date.now().toString().slice(-9);
  return {
    kpostID: `qa.flow.${unique}@kpost.in`,
    mobileNumber: `98765${unique.slice(-5)}`,
    password: testData.password,
  };
}

async function post<T>(
  endpoints: EndpointExecutor,
  endpointId: string,
  body: unknown,
  label: string,
): Promise<{ status: number; body: T }> {
  const exchange = await endpoints.sendTo(
    endpointId,
    { body },
    { label, auth: { header: undefined } },
  );
  const parsed = exchange.json();
  return { status: exchange.status, body: (parsed.ok ? parsed.value : {}) as T };
}

test.describe('KPost Signup & Login · rules from the FRD', () => {
  // These register real accounts, so they share one worker and run in order.
  test.describe.configure({ mode: 'default' });

  test('BR-S02: an identifier already in use is rejected at submission @api @signup-login', async ({
    endpoints,
  }) => {
    /*
     * Asked about an account that certainly exists (the QA login account). The rule is that the
     * check happens at submission - so "available" here would mean a user can complete a form and
     * only discover the clash later, which is what BR-S02 forbids.
     */
    const { status, body } = await post<{ used?: boolean; message?: string; status?: string }>(
      endpoints,
      'signup-login-kpost-id-exist',
      {
        kpostID: testData.kpostId,
        firstName: 'QA',
        lastName: 'Bench',
        mobileNumber: testData.mobileExists,
      },
      'flow:kpostIdExist-taken',
    );

    expect(status, 'the availability check itself must answer').toBeLessThan(500);
    /*
     * The endpoint signals "taken" somewhere in its answer. Which field is not documented, so this
     * asserts the observable outcome rather than a shape: the response must not claim the id is
     * free. An assertion on `used === true` would be inventing a contract.
     */
    const saysAvailable = /can be used|available/i.test(JSON.stringify(body));
    expect(
      saysAvailable,
      `an existing KPost ID must not be reported as available: ${JSON.stringify(body)}`,
    ).toBe(false);
  });

  test('a login failure does not reveal whether the account exists @api @signup-login @security', async ({
    endpoints,
  }) => {
    /*
     * Account enumeration: if "no such user" and "wrong password" answer differently, anyone can
     * discover who has a KPost account. The SRS treats account data as protected, so the two
     * answers must be indistinguishable.
     */
    const wrongPassword = await post<LoginResponse>(
      endpoints,
      'signup-login-user-login',
      AUTH_PROFILES.kpost.loginRequest({
        key: 'enum-existing',
        role: 'USER',
        username: testData.kpostId,
        password: 'DefinitelyNotThePassword!9f2a',
        userType: testData.userType,
      }).body,
      'flow:login-wrong-password',
    );

    const unknownAccount = await post<LoginResponse>(
      endpoints,
      'signup-login-user-login',
      AUTH_PROFILES.kpost.loginRequest({
        key: 'enum-absent',
        role: 'USER',
        username: testData.kpostIdAbsent,
        password: 'DefinitelyNotThePassword!9f2a',
        userType: testData.userType,
      }).body,
      'flow:login-unknown-account',
    );

    expect(wrongPassword.body.accessToken ?? null, 'no token for a wrong password').toBeNull();
    expect(unknownAccount.body.accessToken ?? null, 'no token for an unknown account').toBeNull();
    // Same status and same message, or the difference between them is the enumeration oracle.
    expect(
      { status: unknownAccount.status, message: unknownAccount.body.message },
      'an unknown account and a wrong password must be indistinguishable',
    ).toEqual({ status: wrongPassword.status, message: wrongPassword.body.message });
  });

  test('BR-S01: a newly registered account cannot log in before activation @api @signup-login', async ({
    endpoints,
  }) => {
    /*
     * Registers an account and immediately tries to log in with it.
     *
     * Per BR-S01 the login must fail until the account is activated. If it succeeds, then either
     * activation is not enforced (a requirement is unimplemented) or signup activates immediately
     * (the requirement is stale). Either way the answer belongs in front of a human, which is why
     * this test states the rule and reports what actually happened.
     *
     * It creates a real account, so it only runs with ALLOW_DESTRUCTIVE_TESTS=true.
     */
    test.skip(
      !env.ALLOW_DESTRUCTIVE_TESTS,
      'registers a real account: set ALLOW_DESTRUCTIVE_TESTS=true to run',
    );

    const identity = freshIdentity();
    const signup = await post<SignupResponse>(
      endpoints,
      'signup-login-signup',
      {
        kpostID: identity.kpostID,
        firstName: 'QA',
        lastName: 'Flow',
        mobileNumber: identity.mobileNumber,
        createdDate: Date.now(),
        password: identity.password,
        gender: 'female',
        dateOfBirth: '1995-01-01',
        module: 0,
        countryCode: '91',
        email: testData.otpEmail,
        userProfile: {
          landLineNumber: '04400000000',
          referalId: '',
          pinCode: testData.pinCode,
          areaName: 'Pazhavanthangal',
          state: 'Tamil Nadu',
          city: 'Chennai',
        },
      },
      'flow:signup',
    );

    expect(signup.status, `registration must succeed first: ${JSON.stringify(signup.body)}`).toBe(
      200,
    );

    const login = await post<LoginResponse>(
      endpoints,
      'signup-login-user-login',
      AUTH_PROFILES.kpost.loginRequest({
        key: 'flow-new-account',
        role: 'USER',
        username: identity.kpostID,
        password: identity.password,
        userType: 'PERSONAL',
      }).body,
      'flow:login-before-activation',
    );

    expect(
      login.body.accessToken ?? null,
      `BR-S01: an unactivated account must not receive a token (got HTTP ${login.status}: ${JSON.stringify(login.body)})`,
    ).toBeNull();
  });
});
