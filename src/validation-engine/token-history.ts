import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '@config/constants';

/**
 * A rolling store of minted tokens, so the expired-token check gets a real server-signed token that
 * has aged past its `exp` (one cannot be forged or aged within a run). Only expired tokens are
 * offered; the store holds bearer tokens, so it lives under git-ignored `.auth/`.
 */

export interface StoredToken {
  token: string;
  /** Unix seconds, from the JWT `exp` claim. */
  exp: number;
  recordedAt: number;
}

const STORE = path.join(ROOT_DIR, '.auth', 'token-history.json');
/** Keep the store bounded — a handful of matured tokens is all the check ever needs. */
const MAX_ENTRIES = 20;
/** Drop entries older than this; a long-expired token is as good as any other for the check. */
const MAX_AGE_SECONDS = 14 * 24 * 3600;

function read(): StoredToken[] {
  try {
    if (!existsSync(STORE)) return [];
    const parsed = JSON.parse(readFileSync(STORE, 'utf8')) as unknown;
    return Array.isArray(parsed) ? (parsed as StoredToken[]) : [];
  } catch {
    return [];
  }
}

function write(entries: StoredToken[]): void {
  try {
    mkdirSync(path.dirname(STORE), { recursive: true });
    writeFileSync(STORE, JSON.stringify(entries, null, 2));
  } catch {
    // Best-effort: never fail a run over bookkeeping.
  }
}

/** The `exp` claim from a JWT, or undefined if it cannot be decoded. */
function expOf(token: string): number | undefined {
  try {
    const payload = token.split('.')[1];
    if (!payload) return undefined;
    const claims = JSON.parse(
      Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(),
    ) as { exp?: number };
    return typeof claims.exp === 'number' ? claims.exp : undefined;
  } catch {
    return undefined;
  }
}

/** Records a freshly minted token at login; one with no decodable `exp` is ignored. */
export function recordToken(token: string): void {
  const exp = expOf(token);
  if (!exp) return;
  const now = Math.floor(Date.now() / 1000);
  const others = read().filter((e) => e.token !== token);
  write(pruneTokenHistory([...others, { token, exp, recordedAt: now }], now));
}

/**
 * Which tokens to keep: the newest MAX_ENTRIES plus, per account, the first to mature and the
 * newest expired one (a busy day would otherwise push every token out before it expires). Max age
 * MAX_AGE_SECONDS.
 */
export function pruneTokenHistory(entries: readonly StoredToken[], now: number): StoredToken[] {
  const fresh = entries.filter((e) => now - e.recordedAt < MAX_AGE_SECONDS);
  const newest = [...fresh].sort((a, b) => b.recordedAt - a.recordedAt).slice(0, MAX_ENTRIES);
  const keep = new Set(newest);
  const bySubject = new Map<string, StoredToken[]>();
  for (const e of fresh) {
    const key = subjectOf(e.token) ?? '?';
    bySubject.set(key, [...(bySubject.get(key) ?? []), e]);
  }
  for (const list of bySubject.values()) {
    const live = list.filter((e) => e.exp >= now).sort((a, b) => a.exp - b.exp);
    const expired = list.filter((e) => e.exp < now).sort((a, b) => b.exp - a.exp);
    if (live[0]) keep.add(live[0]);
    if (expired[0]) keep.add(expired[0]);
  }
  return [...keep].sort((a, b) => b.recordedAt - a.recordedAt);
}

function subjectOf(token: string): string | undefined {
  try {
    const payload = token.split('.')[1];
    if (!payload) return undefined;
    const claims = JSON.parse(
      Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(),
    ) as { sub?: string };
    return typeof claims.sub === 'string' ? claims.sub.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

/** The newest stored token past its `exp`, or undefined; never a still-valid token. */
export function oldestExpiredToken(): string | undefined {
  const now = Math.floor(Date.now() / 1000);
  const expired = read()
    .filter((e) => e.exp < now)
    .sort((a, b) => b.exp - a.exp);
  return expired[0]?.token;
}
