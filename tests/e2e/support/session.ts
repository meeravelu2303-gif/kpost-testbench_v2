import type { Page } from '@playwright/test';
import { test } from '@fixtures';

/**
 * Guards the observational UI specs (which FILE bugs) against a signed-out session.
 *
 * A live SPA can invalidate a saved session between `setup` and the run — a single-session limit, an
 * expiry, or a flaky login. When it does, EVERY screen bounces to `/login` and nothing renders, so the
 * screen sweep would report a pile of FALSE bugs ("nav icon missing", "search box missing", …) and
 * file them to the UI developer. That is exactly the false-bug class the bench must never produce.
 *
 * So before each observational test, confirm we are actually signed in; if the app bounced to
 * `/login`, SKIP with a clear reason (re-run `setup`) instead of failing — a session problem is not a
 * UI defect and must not become a ticket.
 */
export async function skipIfSignedOut(page: Page): Promise<void> {
  await page.goto('/home', { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {});

  // The SPA validates the session CLIENT-SIDE and only THEN redirects to /login, so checking the URL
  // right after `domcontentloaded` is too early (it still reads /home). Wait for the app to settle:
  // race the login form against the authenticated shell, then decide on whichever appears.
  const loginForm = page
    .getByText('Sign in to your account', { exact: false })
    .or(page.locator('[placeholder*="KPOST ID" i]'))
    .first();
  const appShell = page.locator('.icon-KP_01-Home, .header_font, .homeWeblasccs').first();
  await Promise.race([
    loginForm.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {}),
    appShell.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {}),
  ]);

  const signedOut = /\/login/i.test(page.url()) || (await loginForm.isVisible().catch(() => false));
  if (signedOut) {
    test.skip(
      true,
      'session bounced to /login (invalid/expired/racey) — re-run `setup` and retry; not a UI defect',
    );
  }
}
