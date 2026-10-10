import { AUTH_PROFILES } from '@config/auth-profile';
import { kmailAuthGate } from '@fixtures/kmail-auth-gate';
import { expect, test } from '@fixtures';

/**
 * KMail credential disclosure — proof for plan item 0b (docs/archive/test-bench-plan-2026-10-02.md §16 P0 /
 * §24 re-justification pass).
 *
 * ## What the source shows
 *
 * `SentMailServiceImpl.getMailCredentials` (`Kpost_Kmail_5.0`):
 *
 *     User userObject = userService.getUserOrGroupPassword(kmailCredentialsRO.getKpostID(), "1111111");
 *     ...
 *     if (userObject.getKmailPassword().equals(kmailCredentialsRO.getPassword())) {
 *       responseObj.setFromAddPassword(userObject.getKmailPassword());   // echoed back in plaintext
 *       ...
 *     } else throw new KPOSTWebServiceException("Invalid password");
 *
 * The lookup key is `kpostID` **from the request body** — never the authenticated token's own
 * identity. So the only gate on reading back ANY account's `kmailPassword` is knowing that
 * account's `kmailPassword` already — there is no check that the caller IS that account. This
 * test proves (or refutes) the one part of that finding this bench can test without a real
 * customer password: whether the endpoint is bound to the caller's own identity at all.
 *
 * ## Why this was blocked, and why it no longer is
 *
 * Registered but never driven on live because of the `testkmail` KMail-401 regression (every
 * token answered 401, making any live call meaningless) — see `kmail-auth-gate.ts`. That
 * regression is confirmed resolved (2026-10-02, 499/1755 validations ran clean on the full dry
 * run), so `KMAIL_AUTH_FIXED=true` is set and this is no longer blocked by it.
 *
 * ## Why this is safe to run
 *
 * Two of this bench's own throwaway accounts, which this environment documents as sharing one
 * default password (`QA_PASSWORD`). No real customer credential is sent or guessed — the only
 * password used is the bench's own already-known shared default. This cannot change any state
 * (the endpoint is a pure lookup); nothing is written and nothing needs cleanup.
 *
 * ## A second, independent blocker (confirmed 2026-10-02, after the above was written)
 *
 * `kmail-credentials` is `sideEffect: 'global'` in its own definition (`manage.api.ts`), and
 * `src/validation-engine/production-guard.ts` refuses ANY `global` write on `TEST_ENV=production`
 * unconditionally, by deliberate design — the same wall documented in `docs/scope/blocked-endpoints-rationale.md` for the
 * admin company-admin writes. This test would throw `ProductionSafetyError` on this environment even
 * if the safety-classifier pause below were lifted. Both blockers are real and independent; lifting
 * one does not lift the other.
 *
 * The actual disclosed password value (if any) is NEVER logged or asserted on directly — only a
 * boolean (`host` present / HTTP status) is read, so this test's own output cannot leak a secret.
 */
const K = AUTH_PROFILES.kpost;
const A = K.principals.find((p) => p.key === 'personal')!; // caller
const B = K.principals.find((p) => p.key === 'victim')!; // target named in the body, not the caller

interface CredentialsResponse {
  host?: string;
  fromAddress?: string;
  fromAddPassword?: string;
}

test.describe('KMail · credential-disclosure IDOR proof (plan item 0b) @api @kmail-api @kmail @security', () => {
  test.skip(kmailAuthGate() !== undefined, kmailAuthGate() ?? '');
  // Confirmed live 2026-10-02: `kmail-credentials` is `sideEffect: 'global'`, which
  // production-guard.ts refuses unconditionally on TEST_ENV=production — KMAIL_LIFECYCLE cannot
  // change that. Independently, this session's own safety classifier also refused the one attempt
  // to run this. Both blockers are real; stays test.skip'd rather than left to fail with
  // ProductionSafetyError every run. See docs/scope/blocked-endpoints-rationale.md.
  test.skip(
    true,
    'PERMANENT on this environment (sideEffect:"global", refused by production-guard.ts) AND ' +
      'requires explicit authorization even on a future non-production environment, given it ' +
      'compares real credential material — see docs/scope/blocked-endpoints-rationale.md',
  );

  test('baseline: the endpoint accepts A\'s own kpostID with the shared default password', async ({
    endpoints,
  }) => {
    const ex = await endpoints.sendTo(
      'kmail-credentials',
      { body: { kpostID: A.username, password: process.env.QA_PASSWORD ?? '' } },
      { label: 'cred-disclosure:self', auth: { principal: A }, allowLiveRead: true },
    );
    test.info().annotations.push({
      type: 'note',
      description: `self-lookup status=${ex.status} (establishes whether kmailPassword == the shared QA default for this account at all, before testing cross-account)`,
    });
    // Not a pass/fail claim by design — a baseline reading only. A 200 means kmailPassword equals
    // the shared default for THIS account; anything else means it does not, which the cross-account
    // test below must then be read in light of. The one assertion here is just "got a response".
    expect(ex.status, 'the endpoint answers (any status) for a well-formed self-lookup').toBeLessThan(600);
  });

  test('IDOR: A\'s token can query B\'s kmailPassword by naming B\'s kpostID, never B\'s own session', async ({
    endpoints,
  }) => {
    const ex = await endpoints.sendTo(
      'kmail-credentials',
      { body: { kpostID: B.username, password: process.env.QA_PASSWORD ?? '' } },
      { label: 'cred-disclosure:cross-account', auth: { principal: A }, allowLiveRead: true },
    );
    const body = ex.status < 300 ? (JSON.parse(ex.bodyText ?? '{}') as CredentialsResponse) : {};
    const disclosed = Boolean(body.host || body.fromAddress || body.fromAddPassword);

    if (disclosed) {
      endpoints.recordBusinessRuleViolation({
        endpointId: 'kmail-credentials',
        ruleId: 'IDOR-kmail-credentials-by-kpostid',
        rule:
          "getMailCredentials must only return the AUTHENTICATED CALLER's own mail credentials — " +
          "it must not disclose another account's credentials just because the caller's token is " +
          'valid and happens to know (or share) that other account\'s kmailPassword.',
        expected: `refused (A's token is not B's session) — status >= 400`,
        actual: `status=${ex.status}, credentials disclosed for ${B.username} to a request authenticated as ${A.username}`,
        request: { body: { kpostID: B.username, password: '(shared QA default — redacted)' } },
      });
    }

    expect
      .soft(
        ex.status,
        "getMailCredentials must refuse a request naming an account other than the caller's own, " +
          'regardless of whether the supplied password happens to be correct for that account',
      )
      .toBeGreaterThanOrEqual(400);
  });
});
