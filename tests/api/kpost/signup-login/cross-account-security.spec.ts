import { randomUUID } from 'node:crypto';
import { AUTH_PROFILES } from '@config/auth-profile';
import { testData } from '@config/test-data.config';
import type { Principal } from '@config/auth.config';
import { expect, test } from '@fixtures';

/**
 * Signup-login **cross-account security** — the two real attack-surface questions
 * `session-lifecycle.spec.ts` doesn't ask: does `fetchUserDetails` over-expose PII for an account
 * that isn't the caller, and can a caller end a session that belongs to someone else by naming
 * their device id? Every other signup-login endpoint takes its target from the auth token, not a
 * payload (`getActiveSession`/`getLoginHistory`, already proven caller-scoped in
 * `session-lifecycle.spec.ts`), so these two are the only genuine foreign-id-shaped surface in the
 * module.
 */
const A = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal')!;
const VICTIM: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'victim')!;

test.describe('KPost signup-login · cross-account security @api @kpost-api @signup-login @security', () => {
  test('fetchUserDetails exposes only login-card fields for an account that is not the caller', async ({
    endpoints,
  }) => {
    const ex = await endpoints.sendTo(
      'signup-login-fetch-user-details',
      { body: { kpostID: testData.victimKpostId, countryID: testData.countryId } },
      { label: 'cross-account:fetch-other', auth: { principal: A } },
    );
    expect(ex.status, 'fetchUserDetails succeeds for a real second account').toBe(200);
    const body = JSON.parse(ex.bodyText || '{}') as { data?: Record<string, unknown> };
    const data = body.data ?? {};

    // The login screen's step 1 needs a name card and the account's userType — nothing more. Any of
    // these appearing would be a real PII leak to an unauthenticated-adjacent, pre-login caller.
    for (const sensitiveField of [
      'password',
      'email',
      'otherEmail',
      'mobileNumber',
      'accessCode',
      'kmailPassword',
      'presentAddress',
      'permanentAddress',
    ]) {
      expect(
        data[sensitiveField],
        `fetchUserDetails must not expose "${sensitiveField}" for an account that is not the caller`,
      ).toBeUndefined();
    }
    // What it SHOULD return: confirmed from a live read, 2026-10-03 — firstName, lastName,
    // companyName, userType, designation, kpostID, countryID. kpostID is expected to echo the id we
    // asked for; the test's real job is proving nothing beyond that safe set comes along with it.
    expect(
      (data.kpostID as string | undefined)?.toLowerCase(),
      'the resolved record is the account we asked about',
    ).toBe(testData.victimKpostId.toLowerCase());
  });

  test('userLogout cannot end a session belonging to a different account', async ({
    endpoints,
  }) => {
    /*
     * Opens a REAL session for VICTIM on its own device (never the shared cached token any other
     * test reuses — same reasoning as `session-lifecycle.spec.ts`'s `freshLogin`). Then, authorized
     * as A, calls userLogout naming VICTIM's device id in the body. If the server scopes the logout
     * by the TOKEN alone (ignoring the body), this is a no-op on A's own session — the correct,
     * walled-off behavior. If it scopes by the body's device id instead, VICTIM's real session gets
     * silently ended by an account that has no relationship to it.
     */
    const victimDevice = randomUUID();
    const victimLoginBase = AUTH_PROFILES.kpost.loginRequest(VICTIM);
    const victimLogin = await endpoints.sendTo(
      'signup-login-user-login',
      {
        body: {
          ...(victimLoginBase.body as Record<string, unknown>),
          sessionID: randomUUID(),
          deviceIdentity_primary: victimDevice,
        },
      },
      { label: 'cross-account:victim-login', auth: { header: undefined } },
    );
    expect(victimLogin.status, "VICTIM's own fresh login succeeds").toBe(200);
    const victimParsed = victimLogin.json();
    const victimToken = victimParsed.ok
      ? (victimParsed.value as { accessToken?: string }).accessToken
      : undefined;
    expect(victimToken, 'the login exposes an access token').toBeTruthy();

    const before = await endpoints.sendTo(
      'signup-login-active-session',
      {},
      { label: 'cross-account:victim-sessions-before', auth: { header: `Bearer ${victimToken}` } },
    );
    expect(before.status, "VICTIM's session list reads back").toBe(200);
    const beforeBody = JSON.parse(before.bodyText || '{}') as {
      data?: Array<{ deviceIdentity_primary?: string }>;
    };
    const wasActive = (beforeBody.data ?? []).some(
      (row) => row.deviceIdentity_primary === victimDevice,
    );
    expect(wasActive, "the fresh session is visible in VICTIM's own active-session list").toBe(
      true,
    );

    // --- The attack: A (not VICTIM) calls userLogout naming VICTIM's device ----------------------
    await endpoints
      .sendTo(
        'signup-login-user-logout',
        {
          body: {
            deviceType: 'Web',
            deviceIdentity_primary: victimDevice,
            logouttime: new Date().toISOString().replace('T', ' ').slice(0, 19),
          },
        },
        { label: 'cross-account:attacker-logout', auth: { principal: A }, allowLiveWrite: true },
      )
      .catch(() => undefined);

    const after = await endpoints.sendTo(
      'signup-login-active-session',
      {},
      { label: 'cross-account:victim-sessions-after', auth: { header: `Bearer ${victimToken}` } },
    );
    const afterBody = JSON.parse(after.bodyText || '{}') as {
      data?: Array<{ deviceIdentity_primary?: string }>;
    };
    const stillActive = (afterBody.data ?? []).some(
      (row) => row.deviceIdentity_primary === victimDevice,
    );
    expect(
      stillActive,
      "BOLA: A's userLogout call (naming VICTIM's device id) must not end VICTIM's own session",
    ).toBe(true);
  });
});
