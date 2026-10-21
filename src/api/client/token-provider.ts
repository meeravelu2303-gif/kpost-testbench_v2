import type { AuthProfile } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { jwtExpiry } from '@utils/jwt';

export type LoginFn = (principal: Principal, profile: AuthProfile) => Promise<string>;

interface CachedToken {
  token: string;
  expiresAt: number;
}

const REFRESH_MARGIN_MS = 60_000;
const FALLBACK_LIFETIME_MS = 10 * 60_000;

// Module scope = one cache per Playwright worker process: parallel-safe, logs in once per
// principal per worker. Pending logins are shared, so concurrent callers never double-login.
const cache = new Map<string, Promise<CachedToken>>();

export class TokenProvider {
  constructor(
    private readonly login: LoginFn,
    /** Separates caches of different API base URLs. */
    private readonly scope: string,
    /**
     * A live token the caller already holds for this principal (a browser project's saved session —
     * `browser-session-token.ts`). Tried first and never cached, so a re-saved session is picked up.
     */
    private readonly existingSession?: (principal: Principal) => string | undefined,
  ) {}

  /**
   * A token for `principal` from `profile`'s login endpoint.
   *
   * The profile is part of the cache key: the same principal key can exist in two profiles (the
   * mock's "admin" and KPost's), and handing a mock-minted token to the live API would be
   * rejected as invalid - a failure that looks like an API defect but is the bench's fault.
   */
  async tokenFor(principal: Principal, profile: AuthProfile): Promise<string> {
    const existing = this.existingSession?.(principal);
    if (existing) return existing;
    const key = `${this.scope}|${profile.id}|${principal.key}`;
    const cached = await cache.get(key)?.catch(() => undefined);
    if (cached && cached.expiresAt - REFRESH_MARGIN_MS > Date.now()) return cached.token;

    const pending = this.login(principal, profile).then((token) => ({
      token,
      expiresAt: jwtExpiry(token) ?? Date.now() + FALLBACK_LIFETIME_MS,
    }));
    cache.set(key, pending);
    try {
      return (await pending).token;
    } catch (error) {
      cache.delete(key);
      throw error;
    }
  }
}
