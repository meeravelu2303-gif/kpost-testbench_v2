import { env } from './env';

/**
 * The LIVE KPost hosts (CLAUDE.md §1). The bench targets the test deployment only, so no request may
 * reach these from any project — API or browser.
 *
 * Browser pages need their own guard: a front-end build decides where it calls, not the bench. The test
 * Admin UI (2026-10-26) was compiled with `LoginURL` and `EndPointURL` = devapi2, so its login screen sent
 * the bench's probe input to the live server. Every browser page now aborts requests to these hosts
 * (`src/fixtures/index.ts`).
 */
export const LIVE_HOSTS: readonly string[] = [
  'adminmodule.kpostindia.com',
  'devapi2.kpostindia.com',
  'account.kpostindia.com',
  'kmail5.kpostindia.com',
];

export const isLiveHost = (hostname: string): boolean => LIVE_HOSTS.includes(hostname);

/**
 * The test host a browser call to a live host is sent to instead, when one exists: the live KPost API
 * (devapi2) → `KPOST_API_BASE_URL` (testingapi). Same path, same body. Other live hosts have none and stay
 * blocked.
 */
export function testCounterpart(hostname: string): URL | undefined {
  if (hostname !== 'devapi2.kpostindia.com' || !env.KPOST_API_BASE_URL) return undefined;
  const test = new URL(env.KPOST_API_BASE_URL);
  return isLiveHost(test.hostname) ? undefined : test;
}
