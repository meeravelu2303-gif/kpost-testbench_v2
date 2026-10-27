import type { Page } from '@playwright/test';
import { test } from '@fixtures';

/**
 * Skips an observational UI spec when the saved session was lost (the app bounced to `/login`), so a
 * session problem never becomes a pile of false UI bugs.
 */
export async function skipIfSignedOut(page: Page): Promise<void> {
  await page.goto('/home', { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {});

  // The SPA redirects to /login only after a client-side check, so race the login form against the
  // signed-in shell instead of reading the URL early.
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
