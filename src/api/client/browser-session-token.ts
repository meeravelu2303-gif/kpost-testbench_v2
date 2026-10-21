import { existsSync, readFileSync } from 'node:fs';
import {
  STORAGE_STATE,
  STORAGE_STATE_2,
  STORAGE_STATE_3,
  STORAGE_STATE_BUSINESS,
} from '@config/constants';
import { jwtExpiry, jwtSubject } from '@utils/jwt';

/**
 * The access token of a SAVED BROWSER SESSION for `username`, when one is live.
 *
 * KPost keeps one session per account: an API login for an account signs out every browser that
 * account is signed into — including the saved session (`.auth/*.json`) that every later UI spec
 * shares. One such login in a long UI run (2026-10-20: `group-exit-e2e` creating its group as
 * qatest1) turned the rest of the run into 300+ blank-screen failures. So in a browser project the
 * API calls REUSE the browser's own session token instead of logging in; the API and the screens then
 * share one session and nothing is signed out.
 *
 * Read fresh on every call (a spec that signs in again re-saves the file mid-run).
 */
const SESSION_FILES = [STORAGE_STATE, STORAGE_STATE_2, STORAGE_STATE_3, STORAGE_STATE_BUSINESS];
const MARGIN_MS = 60_000;

export function browserSessionToken(username: string): string | undefined {
  const who = username.toLowerCase();
  for (const file of SESSION_FILES) {
    if (!existsSync(file)) continue;
    let state: { origins?: Array<{ localStorage?: Array<{ name: string; value: string }> }> };
    try {
      state = JSON.parse(readFileSync(file, 'utf8')) as typeof state;
    } catch {
      continue;
    }
    for (const origin of state.origins ?? []) {
      const token = origin.localStorage?.find((e) => e.name === 'accessToken')?.value;
      if (!token || jwtSubject(token)?.toLowerCase() !== who) continue;
      const expiry = jwtExpiry(token);
      if (expiry !== undefined && expiry - MARGIN_MS > Date.now()) return token;
    }
  }
  return undefined;
}
