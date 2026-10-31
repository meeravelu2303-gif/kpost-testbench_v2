import { randomUUID } from 'node:crypto';
import { AUTH_PROFILES } from '@config/auth-profile';
import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';

/**
 * Session and token rules: user lookup, login history, getActiveSession, refresh-token redemption.
 * A new login invalidates the account's previous session, so the login tests use `personal-5` with
 * its own literal token and never disturb the shared cached `personal` token.
 */
const A = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal')!;
const FRESH = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal-5')!;

/** A login on its own device id, for a principal the shared token cache never touches. */
async function freshLogin(
  endpoints: EndpointExecutor,
): Promise<{ status: number; accessToken?: string; refreshToken?: string; device: string }> {
  const device = randomUUID();
  const base = AUTH_PROFILES.kpost.loginRequest(FRESH);
  const ex = await endpoints.sendTo(
    'signup-login-user-login',
    {
      body: {
        ...(base.body as Record<string, unknown>),
        sessionID: randomUUID(),
        deviceIdentity_primary: device,
      },
    },
    { label: 'session-lifecycle:fresh-login', auth: { header: undefined } },
  );
  const parsed = ex.json();
  const values = parsed.ok ? (parsed.value as Record<string, unknown>) : {};
  return {
    status: ex.status,
    accessToken: values.accessToken as string | undefined,
    refreshToken: values.refreshToken as string | undefined,
    device,
  };
}

test.describe(
  'KPost signup-login · session and token business rules @api @kpost-api @signup-login',
  { tag: ['@api', '@auth', '@regression'] },
  () => {
    test(
      'fetchUserDetails resolves a real account and rejects an unknown kpostID',
      { annotation: [{ type: 'requirement', description: 'FR-SL-024' }] },
      async ({ endpoints }) => {
        const [known, absent] = await Promise.all([
          endpoints.sendTo(
            'signup-login-fetch-user-details',
            { body: { kpostID: testData.kpostId, countryID: testData.countryId } },
            { label: 'session-lifecycle:fetch-known', auth: { principal: A } },
          ),
          endpoints.sendTo(
            'signup-login-fetch-user-details',
            { body: { kpostID: testData.kpostIdAbsent, countryID: testData.countryId } },
            { label: 'session-lifecycle:fetch-absent', auth: { principal: A } },
          ),
        ]);
        expect(known.status, 'a real kpostID resolves').toBe(200);
        const knownBody = JSON.parse(known.bodyText || '{}') as { data?: { kpostID?: string } };
        expect(
          knownBody.data?.kpostID?.toLowerCase(),
          'the resolved record is the account we asked for',
        ).toBe(testData.kpostId.toLowerCase());
        expect(
          absent.status,
          'a known-absent kpostID is rejected, not silently resolved',
        ).toBeGreaterThanOrEqual(400);
        expect(
          absent.status,
          'rejecting an unknown id is a client error, not a crash',
        ).toBeLessThan(500);
      },
    );

    test('getLoginHistory returns well-shaped rows for the caller only, matching TBL_KPOST_LOGIN_HISTORY', async ({
      endpoints,
      databases,
    }) => {
      const today = new Date().toISOString().slice(0, 10);
      const ex = await endpoints.sendTo(
        'signup-login-login-history',
        { body: { selectedDate: today } },
        { label: 'session-lifecycle:login-history', auth: { principal: A } },
      );
      expect(ex.status, 'getLoginHistory succeeds').toBe(200);
      const body = JSON.parse(ex.bodyText || '{}') as {
        data?: Array<{ kpostID?: string }>;
      };
      for (const row of body.data ?? []) {
        expect(
          row.kpostID?.toLowerCase(),
          "every history row belongs to the caller's own account, never someone else's",
        ).toBe(testData.kpostId.toLowerCase());
      }

      // Cross-check against the real table the API reads from, not just the API's own shape.
      const database = databases.for('kpost-api');
      if (database.enabled) {
        const rows = await database.findMany<{ kpost_id: string }>({
          table: 'TBL_KPOST_LOGIN_HISTORY',
          where: { kpost_id: testData.kpostId },
        });
        expect(
          rows.length,
          "the account has at least one real row in TBL_KPOST_LOGIN_HISTORY (today's shared-session logins)",
        ).toBeGreaterThan(0);
      }
    });

    test('kpostIDsuggestionList suggests names actually derived from the caller', async ({
      endpoints,
    }) => {
      const ex = await endpoints.sendTo(
        'signup-login-kpost-id-suggestions',
        {
          body: {
            kpostID: testData.signupKpostId,
            firstName: 'QA',
            lastName: 'Bench',
            mobileNumber: testData.signupMobile,
          },
        },
        { label: 'session-lifecycle:suggestions', auth: { principal: A } },
      );
      expect(ex.status, 'kpostIDsuggestionList succeeds').toBe(200);
      const body = JSON.parse(ex.bodyText || '{}') as { data?: string[] };
      expect(body.data?.length, 'at least one suggestion is returned').toBeGreaterThan(0);
      for (const suggestion of body.data ?? []) {
        expect(
          suggestion.toLowerCase(),
          `suggestion "${suggestion}" is derived from the given name (QA Bench), not arbitrary`,
        ).toMatch(/^qa/);
      }
    });

    test('the GET variant of the signup route answers 405, not a crash', async ({ endpoints }) => {
      const ex = await endpoints.sendTo(
        'signup-login-signup-get',
        {},
        { label: 'session-lifecycle:signup-get', auth: { principal: A } },
      );
      expect(ex.status, 'GET on the signup path is Method Not Allowed').toBe(405);
    });

    test('getActiveSession reflects a session a fresh login just created', async ({
      endpoints,
    }) => {
      const login = await freshLogin(endpoints);
      expect(login.status, 'the login succeeds').toBe(200);

      const sessions = await endpoints.sendTo(
        'signup-login-active-session',
        {},
        {
          label: 'session-lifecycle:active-session',
          auth: { header: `Bearer ${login.accessToken}` },
        },
      );
      expect(sessions.status, 'getActiveSession succeeds').toBe(200);
      const body = JSON.parse(sessions.bodyText || '{}') as {
        data?: Array<{ deviceIdentity_primary?: string }>;
      };
      expect(
        body.data?.some((row) => row.deviceIdentity_primary === login.device),
        'the session this login just opened is visible in getActiveSession',
      ).toBe(true);
    });

    test('generateJWTokens redeems its own session refresh token and rejects a different session of the same account', async ({
      endpoints,
    }) => {
      const first = await freshLogin(endpoints);
      const second = await freshLogin(endpoints); // a second login for the SAME account
      expect(first.status, 'the first login succeeds').toBe(200);
      expect(second.status, 'the second login succeeds').toBe(200);
      expect(second.refreshToken, 'a login response exposes a refreshToken').toBeTruthy();

      const ownSession = await endpoints.sendTo(
        'signup-login-generate-jwt',
        { body: { refreshToken: second.refreshToken } },
        {
          label: 'session-lifecycle:generate-jwt-own-session',
          auth: { header: `Bearer ${second.accessToken}` },
          allowLiveRead: true,
        },
      );
      expect(
        ownSession.status,
        'redeeming a refresh token while authorized as the SAME session it was issued to succeeds',
      ).toBe(200);

      const otherSession = await endpoints.sendTo(
        'signup-login-generate-jwt',
        { body: { refreshToken: first.refreshToken } },
        {
          label: 'session-lifecycle:generate-jwt-other-session',
          // A valid session, but not the one `first.refreshToken` was issued to.
          auth: { header: `Bearer ${second.accessToken}` },
          allowLiveRead: true,
        },
      );
      expect(
        otherSession.status,
        'redeeming a refresh token while authorized as a DIFFERENT session of the same account ' +
          '(even a currently-valid one) is refused, not honoured',
      ).toBe(401);
    });
  },
);
