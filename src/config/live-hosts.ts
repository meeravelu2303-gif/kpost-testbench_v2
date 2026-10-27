import { env } from './env';

/**
 * The live KPost hosts, which no request may reach (API or browser). Browser pages abort calls to
 * them (`src/fixtures/index.ts`), since a front-end build decides where it calls.
 */
export const LIVE_HOSTS: readonly string[] = [
  'adminmodule.kpostindia.com',
  'devapi2.kpostindia.com',
  'account.kpostindia.com',
  'kmail5.kpostindia.com',
];

export const isLiveHost = (hostname: string): boolean => LIVE_HOSTS.includes(hostname);

/**
 * Test host a browser call to a live host is redirected to (live KPost API → testingapi); others
 * stay blocked.
 */
export function testCounterpart(hostname: string): URL | undefined {
  if (hostname !== 'devapi2.kpostindia.com' || !env.KPOST_API_BASE_URL) return undefined;
  const test = new URL(env.KPOST_API_BASE_URL);
  return isLiveHost(test.hostname) ? undefined : test;
}
