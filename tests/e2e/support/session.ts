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
  if (/\/login/i.test(page.url())) {
    test.skip(
      true,
      'session bounced to /login (invalid/expired/racey) — re-run `setup` and retry; not a UI defect',
    );
  }
}
