import { AUTH_PROFILES } from '@config/auth-profile';
import { kmailAuthGate } from '@fixtures/kmail-auth-gate';
import { expect, test } from '@fixtures';

/**
 * KMail credential disclosure (IDOR): getMailCredentials looks up the body's kpostID, not the
 * caller's, so A's token may read B's mail credentials. Skipped: the endpoint is sideEffect 'global',
 * which the production guard always refuses. A disclosed password is never logged, only a boolean.
 */
const K = AUTH_PROFILES.kpost;
const A = K.principals.find((p) => p.key === 'personal')!; // caller
const B = K.principals.find((p) => p.key === 'victim')!; // target named in the body, not the caller

interface CredentialsResponse {
  host?: string;
  fromAddress?: string;
  fromAddPassword?: string;
}

test.describe(
  'KMail · credential-disclosure IDOR proof (plan item 0b) @api @kmail-api @kmail @security',
  {
    tag: ['@api', '@kmail', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    test.skip(kmailAuthGate() !== undefined, kmailAuthGate() ?? '');
    test.skip(
      true,
      'PERMANENT on this environment (sideEffect:"global", refused by production-guard.ts) AND ' +
        'requires explicit authorization even on a future non-production environment, given it ' +
        'compares real credential material — see docs/generated/blocked-endpoints.md',
    );

    test("baseline: the endpoint accepts A's own kpostID with the shared default password", async ({
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
      // A baseline reading only: 200 means this account's kmailPassword is the shared QA default.
      expect(
        ex.status,
        'the endpoint answers (any status) for a well-formed self-lookup',
      ).toBeLessThan(600);
    });

    test("IDOR: A's token can query B's kmailPassword by naming B's kpostID, never B's own session", async ({
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
            "valid and happens to know (or share) that other account's kmailPassword.",
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
  },
);
