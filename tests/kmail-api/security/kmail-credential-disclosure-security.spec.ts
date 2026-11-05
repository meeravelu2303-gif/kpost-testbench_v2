import { AUTH_PROFILES } from '@config/auth-profile';
import type { AuthMode, EndpointExecutor } from '@engine/endpoint-executor';
import { isSqlClient } from '@database/database-client';
import { kmailAuthGate } from '@fixtures/kmail-auth-gate';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * KMail getMailCredentials (SentMailServiceImpl.getMailCredentials) returns an account's mailbox
 * password when the body's kpostID and password match; it reads the account from the BODY, not the
 * token. Checked on the QA server: the account's own call works (the control), a wrong password and
 * an unknown account are refused cleanly (not 500), no token is refused, and another account's
 * token is refused even with the right password. Passwords come from the QA database and are never
 * printed: reports mask every password key, and only booleans are recorded.
 */
const K = AUTH_PROFILES.kpost;
const A = K.principals.find((p) => p.key === 'personal-5'); // the caller
const B = K.principals.find((p) => p.key === 'personal-4'); // the account named in the body

interface Credentials {
  data?: { host?: string; fromAddress?: string; fromAddPassword?: string };
}

const ask = (
  endpoints: EndpointExecutor,
  kpostID: string,
  password: string,
  auth: AuthMode,
  label: string,
) =>
  endpoints.sendTo(
    'kmail-credentials',
    { body: { kpostID, password } },
    { label: `kmail-credentials:${label}`, auth, allowLiveRead: true },
  );

const disclosed = (bodyText: string | undefined): boolean => {
  const data = (JSON.parse(bodyText || '{}') as Credentials).data;
  return Boolean(data?.fromAddPassword || data?.fromAddress);
};

test.describe(
  'KMail · getMailCredentials gives an account’s mailbox password only to that account',
  {
    tag: ['@api', '@kmail', '@security', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    test.skip(kmailAuthGate() !== undefined, kmailAuthGate() ?? '');
    test.skip(
      process.env.TEST_DB_MODE !== 'true',
      'reads QA mailbox passwords from the test database; set TEST_DB_MODE=true',
    );
    test.skip(!A || !B, 'needs the 4th and 5th QA accounts');

    test('own account works; wrong password, unknown account, no token and another account are refused', async ({
      endpoints,
      databases,
    }) => {
      const db = databases.for('kpost-api');
      test.skip(!isSqlClient(db), 'needs the KPOST_QA database to read the mailbox passwords');
      if (!isSqlClient(db)) return;
      const passwordOf = async (kpostId: string): Promise<string> => {
        const [row] = await db.query<{ kmail_password: string }>(
          'SELECT kmail_password FROM TBL_KPOST_USER_MASTER WHERE kpost_id = ?',
          [kpostId],
        );
        return row?.kmail_password ?? '';
      };
      const passwordA = await passwordOf(A!.username);
      const passwordB = await passwordOf(B!.username);
      test.skip(
        !passwordA || !passwordB,
        'needs provisioned KMail mailboxes for the 4th and 5th QA accounts (no kmail_password row)',
      );

      // Control: the account's own call with its own password returns its credentials.
      const own = await ask(endpoints, A!.username, passwordA, { principal: A! }, 'own');
      expect.soft(own.status, 'the account can read its own mail credentials').toBe(200);
      expect.soft(disclosed(own.bodyText), 'and they are returned').toBe(true);

      // Bad input is refused as bad input, not as a server crash.
      for (const [label, kpostID, password] of [
        ['wrong password', A!.username, 'QA-bench-wrong-password'],
        ['unknown account', testData.kpostIdAbsent, 'QA-bench-wrong-password'],
      ] as const) {
        const res = await ask(endpoints, kpostID, password, { principal: A! }, label);
        expect.soft(disclosed(res.bodyText), `${label}: nothing is disclosed`).toBe(false);
        expect
          .soft(res.status, `${label}: refused with a 4xx, not a server error (got ${res.status})`)
          .toBeGreaterThanOrEqual(400);
        expect
          .soft(res.status, `${label}: refused with a 4xx, not a server error`)
          .toBeLessThan(500);
      }

      const anonymous = await ask(
        endpoints,
        A!.username,
        passwordA,
        { header: undefined },
        'no-token',
      );
      expect.soft(disclosed(anonymous.bodyText), 'no token: nothing is disclosed').toBe(false);
      expect.soft(anonymous.status, 'no token: refused (401)').toBe(401);

      // IDOR: A's token naming B, with B's correct password.
      const cross = await ask(
        endpoints,
        B!.username,
        passwordB,
        { principal: A! },
        'cross-account',
      );
      const leaked = disclosed(cross.bodyText);
      if (leaked) {
        endpoints.recordBusinessRuleViolation({
          endpointId: 'kmail-credentials',
          ruleId: 'IDOR-kmail-credentials-by-kpostid',
          rule: "getMailCredentials must return only the signed-in caller's own credentials; it reads the account from the body, so another account's token gets them.",
          expected: "refused: the token is not the named account's",
          actual: `status ${cross.status}: ${B!.username}'s mail credentials returned to ${A!.username}'s token`,
          request: { body: { kpostID: B!.username, password: '(redacted)' } },
        });
      }
      expect
        .soft(leaked, `another account's token gets nothing (answered ${cross.status})`)
        .toBe(false);
    });
  },
);
