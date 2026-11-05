import { TokenProvider } from '@api/client/token-provider';
import type { AuthProfile } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { expect, test } from '@playwright/test';

/**
 * In a browser project the API reuses the browser's saved session (`browser-session-token.ts`):
 * KPost keeps one session per account, so an API login would sign the screens out.
 */
const principal = { key: 'personal', username: 'qatest1@kpostindia.com' } as unknown as Principal;
const profile = { id: 'kpost-test-session' } as unknown as AuthProfile;

test.describe('TokenProvider · reuse a held browser session before logging in @framework', () => {
  test('a held session token is used and no login happens @framework', async () => {
    let logins = 0;
    const tokens = new TokenProvider(
      () => {
        logins += 1;
        return Promise.resolve('logged-in');
      },
      'scope-held',
      () => 'browser-session',
    );
    expect(await tokens.tokenFor(principal, profile)).toBe('browser-session');
    expect(logins, 'no API login while the browser session is live').toBe(0);
  });

  test('with no held session it logs in, as before @framework', async () => {
    let logins = 0;
    const tokens = new TokenProvider(
      () => {
        logins += 1;
        return Promise.resolve('logged-in');
      },
      'scope-none',
      () => undefined,
    );
    expect(await tokens.tokenFor(principal, profile)).toBe('logged-in');
    expect(logins).toBe(1);
  });
});
