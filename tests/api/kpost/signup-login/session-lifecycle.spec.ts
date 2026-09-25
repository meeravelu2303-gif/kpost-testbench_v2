import { randomUUID } from 'node:crypto';
import { AUTH_PROFILES } from '@config/auth-profile';
import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';

/**
 * Signup-login **session/token business rules** — the endpoints Phase 2 calls out by name as the
 * "token/session validation" category, none of which had a business-rule test before this file.
 *
 * `signup-login-active-session` and `signup-login-login-history` are `productionSafe: true` reads;
 * `signup-login-fetch-user-details`/`kpost-id-suggestions` are public/no-op writes, also
 * `productionSafe: true`. Those run against the SHARED cached `personal` principal like every other
 * test in the run — they only ever read, never log in, so they cannot disturb it.
 *
 * ## Why the login-chain tests use a DIFFERENT, otherwise-unused principal
 *
 * Live-verified 2026-09-24: logging in again for an account invalidates that account's PREVIOUS
 * session immediately, server-side — confirmed by logging in on a brand-new random device id and
 * watching the shared cached principal's token 401 on its very next call, even though nothing in
 * this bench touched that device. The engine's own token cache (`token-provider.ts`) only re-logs-in
 * when a cached JWT's OWN expiry has passed — it has no way to know the server invalidated it early
 * — so this would poison the shared `personal` token for the rest of the run (`workers: 1`, one
 * cache per worker process). `signup-login-generate-jwt` and the getActiveSession chain below both
 * NEED a second login to exist, so they run it against `personal-5` (`QA_PERSONAL_5_KPOST_ID`)
 * instead — configured but, as of this writing, referenced nowhere else in the suite (verified by
 * search), and authorized with the login's own literal token (`auth: { header: ... }`) rather than
 * `auth: { principal }`, so the engine's token cache for that principal is never touched either way.
 *
 * ## `generate-jwt`'s own definition undersold it
 *
 * The endpoint definition's comment says testingapi's login response "does not expose a
 * `refreshToken` where the chain can read it". Live-verified 2026-09-24: it does — the chain helper
 * just reuses the shared cached login, which the bench never re-logs-in to read a fresh
 * `refreshToken` from. A dedicated login exposes one, and redeeming it is genuinely device/session-
 * scoped: it works when the caller is authorized with THAT SAME login's own access token, and is
 * refused (401) when authorized with a DIFFERENT (even currently-valid) session's token for the same
 * account. Both branches are exercised below with two `personal-5` logins, never the shared cache.
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
  () => {
    test('fetchUserDetails resolves a real account and rejects an unknown kpostID', async ({
      endpoints,
    }) => {
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
      expect(absent.status, 'rejecting an unknown id is a client error, not a crash').toBeLessThan(
        500,
      );
    });

    test('getLoginHistory returns well-shaped rows for the caller only', async ({ endpoints }) => {
      const ex = await endpoints.sendTo(
        'signup-login-login-history',
        { body: { selectedDate: new Date().toISOString().slice(0, 10) } },
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
        "redeeming a refresh token while authorized as the SAME session it was issued to succeeds",
      ).toBe(200);

      const otherSession = await endpoints.sendTo(
        'signup-login-generate-jwt',
        { body: { refreshToken: first.refreshToken } },
        {
          label: 'session-lifecycle:generate-jwt-other-session',
          // `second` is the account's CURRENT session (still valid — the login above proves it works),
          // but it is not the session `first.refreshToken` was issued to.
          auth: { header: `Bearer ${second.accessToken}` },
          allowLiveRead: true,
        },
      );
      expect(
        otherSession.status,
        "redeeming a refresh token while authorized as a DIFFERENT session of the same account " +
          '(even a currently-valid one) is refused, not honoured',
      ).toBe(401);
    });
  },
);
