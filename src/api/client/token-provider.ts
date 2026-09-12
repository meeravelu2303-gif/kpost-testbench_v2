import type { Principal } from '@config/auth.config';
import { jwtExpiry } from '@utils/jwt';

export type LoginFn = (principal: Principal) => Promise<string>;

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
  ) {}

  async tokenFor(principal: Principal): Promise<string> {
    const key = `${this.scope}|${principal.key}`;
    const cached = await cache.get(key)?.catch(() => undefined);
    if (cached && cached.expiresAt - REFRESH_MARGIN_MS > Date.now()) return cached.token;

    const pending = this.login(principal).then((token) => ({
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
