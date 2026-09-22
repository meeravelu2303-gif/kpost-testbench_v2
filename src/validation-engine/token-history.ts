import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '@config/constants';

/**
 * A rolling store of tokens this bench has minted, so the expired-token check never has to skip.
 *
 * ## The problem it solves
 *
 * `authentication.expired-token` needs a token this server actually signed and that has since
 * expired. The server verifies signatures, so one cannot be forged; tokens live ~24h, so one cannot
 * be aged on demand within a run. Left there, the check skips forever unless someone remembers to
 * set EXPIRED_TOKEN by hand.
 *
 * ## How it removes the skip
 *
 * Every run records the token it logged in with here, stamped with the `exp` from the JWT. The
 * check then asks for the newest token whose `exp` is already in the past. In steady state — any
 * environment run more than once across a token lifetime, which a nightly or CI cadence always is —
 * there is always a matured token from an earlier run, so the check runs every time and never skips.
 *
 * The one unavoidable exception is the very first run on a brand-new checkout: nothing has aged yet.
 * That is physics, not a gap — a 24h token cannot be expired the instant it is issued. From the
 * second run past a token lifetime onward it is fully automatic.
 *
 * ## Why it is safe
 *
 * A token is only ever OFFERED once its own `exp` has passed, so the check can never be handed a
 * live token and made to fail falsely (the failure mode demonstrated when EXPIRED_TOKEN was pointed
 * at a valid token). The store holds bearer tokens, so it lives under `.auth/`, which is git-ignored
 * alongside the other credential state.
 */

interface StoredToken {
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
    // Best-effort: a bench that cannot write its token history still runs, the check just skips as
    // before. Never fail a run over bookkeeping.
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

/**
 * Record a freshly minted token. Called wherever the bench logs in, so capture is automatic — no
 * separate step, exactly as "save the token when the login happens". A token with no decodable `exp`
 * is ignored (nothing can decide when it matures).
 */
export function recordToken(token: string): void {
  const exp = expOf(token);
  if (!exp) return;
  const now = Math.floor(Date.now() / 1000);
  const kept = read().filter((e) => e.token !== token && now - e.recordedAt < MAX_AGE_SECONDS);
  kept.push({ token, exp, recordedAt: now });
  // Newest first, capped.
  kept.sort((a, b) => b.recordedAt - a.recordedAt);
  write(kept.slice(0, MAX_ENTRIES));
}

/**
 * The newest stored token that is genuinely past its `exp`, or undefined when none has matured yet.
 * Never returns a still-valid token, so the expired-token check cannot be fed a live one.
 */
export function oldestExpiredToken(): string | undefined {
  const now = Math.floor(Date.now() / 1000);
  const expired = read()
    .filter((e) => e.exp < now)
    .sort((a, b) => b.exp - a.exp);
  return expired[0]?.token;
}
