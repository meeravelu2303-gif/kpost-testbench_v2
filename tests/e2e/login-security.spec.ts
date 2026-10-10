import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';

/**
 * Security-fuzzing angle for the Login screen's id field — the counterpart to
 * `signup-validation.spec.ts`'s XSS check on Signup's name fields (#817), which never touched Login.
 * The id field is a lookup-only input (`fetchUserDetails`, a read, no account mutation), so every
 * payload here is safe to submit directly: worst case is a "doesn't exist" toast.
 *
 * ## What this checks, and what it deliberately does NOT
 *
 * An earlier version of this file asserted the raw payload must never appear anywhere in
 * `document.body.innerHTML`. That was the wrong test and produced 3 false positives: a controlled
 * React `<input>` legitimately serializes its own typed value into its `value="…"` attribute — live-
 * confirmed here (`value="' OR '1'='1"`), a plain text field showing what was typed, not a
 * vulnerability. A lone `'` inside a `value="…"` (double-quoted) attribute cannot break out of it
 * either way.
 *
 * The correct signal for "did this payload actually execute as code" is whether it fired its own
 * `alert(1)` — caught here via a `dialog` listener, not string-matching. `<script>` tags inserted via
 * `innerHTML`/`dangerouslySetInnerHTML` never execute in a browser (a deliberate, universal browser
 * behaviour) — the `img onerror` payload is the one that WOULD still fire if some downstream toast or
 * message ever rendered this id unsafely, so it is the payload that actually proves the negative.
 * The SQL-style/template-literal payloads have no client-side execution vector at all; they are kept
 * only for the crash check (a malformed id must not be what breaks the page) and SQLi proper belongs
 * at the API layer, not here.
 */
test.describe('KPost login · security fuzzing', { tag: '@ui' }, () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  const PAYLOADS: Array<{ name: string; value: string }> = [
    { name: 'script tag', value: '<script>alert(1)</script>' },
    { name: 'img onerror breakout', value: '"><img src=x onerror=alert(1)>' },
    { name: 'SQL-style OR-true', value: "' OR '1'='1" },
    { name: 'SQL-style comment terminator', value: "admin'--" },
    { name: 'template-literal injection', value: '${7*7}' },
  ];

  for (const payload of PAYLOADS) {
    test(`the login id field survives a ${payload.name} payload without crashing or executing it @ui`, async ({
      page,
      loginPage,
    }) => {
      const stop = watchUiHealth(page);
      let dialogFired = false;
      page.on('dialog', (dialog) => {
        dialogFired = true;
        void dialog.dismiss();
      });

      await page.goto(loginPage.path, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await loginPage.expectLoaded();

      await loginPage.loginIdInput.fill(payload.value);
      await loginPage.loginIdInput.press('Escape');
      await loginPage.loginIdInput.press('Enter');

      // Let the lookup (fetchUserDetails, or the client-side reject if it never leaves the browser)
      // settle either way it resolves, without asserting which — that outcome is not the point here.
      await page
        .getByText(/doesn't exist|invalid/i)
        .first()
        .waitFor({ state: 'visible', timeout: 10_000 })
        .catch(() => undefined);
      // A dialog from an injected handler can fire slightly after the toast settles.
      await page.waitForTimeout(1_000);

      const health = stop();

      test.info().annotations.push({
        type: 'observed',
        description: `page errors: ${JSON.stringify(health.pageErrors)}; dialog fired: ${dialogFired}`,
      });

      expect(health.pageErrors, `no uncaught JS error while processing: ${payload.value}`).toEqual(
        [],
      );
      expect(
        dialogFired,
        `the payload must never execute (no alert/confirm/prompt fired) — reflected/DOM XSS: ${payload.value}`,
      ).toBe(false);
    });
  }
});
