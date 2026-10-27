import fs from 'node:fs';
import { env } from '@config/env';
import type { Browser } from '@playwright/test';

/**
 * Opt-in (REUSE_SESSION=true) reuse of a stored session, to avoid login throttling. A fresh file can
 * already be dead (one session per account), so it opens /home and reuses the state only if the
 * signed-in shell renders; otherwise it returns false and the setup logs in again.
 */
export async function reuseValidSession(
  browser: Browser,
  statePath: string,
  log?: { info?: (m: string) => void },
): Promise<boolean> {
  if (process.env.REUSE_SESSION !== 'true') return false;
  try {
    const st = fs.statSync(statePath);
    if (!st.size) return false;
    const ttlMin = Number(process.env.SESSION_TTL_MIN ?? 180);
    const ageMin = Math.round((Date.now() - st.mtimeMs) / 60_000);
    if (ageMin > ttlMin) {
      log?.info?.(
        `REUSE_SESSION: stored session is ${ageMin}m old (> ${ttlMin}m TTL) — re-logging in`,
      );
      return false;
    }
    const ctx = await browser.newContext({ storageState: statePath, baseURL: env.BASE_URL });
    try {
      const page = await ctx.newPage();
      await page.goto('/home', { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
      // The SPA validates the session CLIENT-SIDE, then redirects to /login — so race the login form
      // against the authenticated shell and decide on whichever appears (same pattern as skipIfSignedOut).
      const loginForm = page
        .getByText('Sign in to your account', { exact: false })
        .or(page.locator('[placeholder*="KPOST ID" i]'))
        .first();
      const appShell = page.locator('.icon-KP_01-Home, .header_font, .homeWeblasccs').first();
      await Promise.race([
        loginForm.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {}),
        appShell.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {}),
      ]);
      const signedOut =
        /\/login/i.test(page.url()) || (await loginForm.isVisible().catch(() => false));
      const shell = await appShell.isVisible().catch(() => false);
      const valid = !signedOut && shell;
      log?.info?.(
        valid
          ? `REUSE_SESSION: validated existing session (${ageMin}m old) — skipping login`
          : 'REUSE_SESSION: stored session invalid/expired — re-logging in',
      );
      return valid;
    } finally {
      await ctx.close();
    }
  } catch {
    return false;
  }
}
