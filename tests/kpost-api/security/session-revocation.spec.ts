import { randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import { AUTH_PROFILES } from '@config/auth-profile';
import { env } from '@config/env';
import { expect, test } from '@fixtures';

/**
 * A token that was logged out stays dead. The server checks only that the token's device has a
 * session, so a logged-out token works again once the user logs in on that device again (#13389).
 * Runs on the 4th QA account with a device id of its own, so no shared session is touched.
 */
const ACCOUNT = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal-4');
const BASE = (env.KPOST_API_BASE_URL ?? env.API_BASE_URL ?? '').replace(/\/+$/, '');

async function loginOn(request: APIRequestContext, device: string): Promise<string> {
  const res = await request.post(`${BASE}/v2/signupLogin/userLogin/`, {
    data: {
      deviceType: 'Web',
      deviceIdentity_primary: device,
      deviceIdentity_secondary: 'QA-Bench-Revocation',
      login_lattitude: 13.04,
      login_longitude: 80.26,
      oneSignal_Key: 'qa-bench',
      voip: 'voip',
      module: 0,
      sessionID: randomUUID(),
      kpostID: ACCOUNT!.username,
      loginRO: { countryID: '1', password: ACCOUNT!.password, userType: 'PERSONAL' },
      logintime: Date.now(),
    },
    failOnStatusCode: false,
  });
  const token = ((await res.json()) as { accessToken?: string }).accessToken;
  expect(token, `the account signs in (${res.status()})`).toBeTruthy();
  return token!;
}

const readWith = async (request: APIRequestContext, token: string): Promise<number> =>
  (
    await request.get(`${BASE}/v2/profile/getlanguages/`, {
      headers: { Authorization: `Bearer ${token}` },
      failOnStatusCode: false,
    })
  ).status();

test.describe(
  'KPost sessions · a logged-out token stays dead @api @kpost-api @signup-login @security',
  {
    tag: ['@api', '@signup-login', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    test.skip(!ACCOUNT?.username || !BASE, 'needs the 4th QA account and the KPost API host');

    test('a logged-out token is still refused after the user logs in again on the same device', async ({
      request,
    }) => {
      const device = randomUUID();
      const first = await loginOn(request, device);
      expect(await readWith(request, first), 'the new token works').toBe(200);

      const logout = await request.post(`${BASE}/v2/signupLogin/userLogout/`, {
        headers: { Authorization: `Bearer ${first}` },
        data: {
          deviceType: 'Web',
          deviceIdentity_primary: device,
          logouttime: new Date().toISOString().replace('T', ' ').slice(0, 19),
        },
        failOnStatusCode: false,
      });
      expect(logout.status(), 'logout succeeds').toBeLessThan(400);
      expect(await readWith(request, first), 'right after logout the token is refused').toBe(401);

      const second = await loginOn(request, device);
      expect(await readWith(request, second), 'the next login works').toBe(200);
      expect
        .soft(
          await readWith(request, first),
          'the logged-out token must stay refused after the next login on that device (#13389)',
        )
        .toBe(401);
    });
  },
);
