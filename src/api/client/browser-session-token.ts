import { existsSync, readFileSync } from 'node:fs';
import {
  STORAGE_STATE,
  STORAGE_STATE_2,
  STORAGE_STATE_3,
  STORAGE_STATE_BUSINESS,
} from '@config/constants';
import { jwtExpiry, jwtSubject } from '@utils/jwt';

/**
 * The access token of a saved browser session for `username`. KPost allows one session per account,
 * so browser projects reuse it instead of an API login that would sign the browser out. Read fresh
 * each call.
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
