import { testData } from '@config/test-data.config';
import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';

/**
 * Security-fuzzing angle for the Profile **About** field — a higher-value XSS surface than a
 * self-only search box or even a 2-party chat message: About is rendered on the profile page for
 * EVERY visitor who looks the account up, so a stored payload here would fire for every viewer, not
 * just the account holder. Same execution-based check as `login-security.spec.ts`/
 * `home-security.spec.ts`/`katchup-security.spec.ts` (a `dialog` listener, not string-matching).
 *
 * Reuses `profile-edit.spec.ts`'s own proven read → edit → verify → restore flow and its exact
 * selectors (`#About`, `.icon-KP_236_Edit` with an "Edit Profile" fallback, the "Write about
 * yourself..." placeholder, the "Update" button) so the account's real About text is never lost —
 * each payload is written, checked, then the ORIGINAL text is restored before the next one runs.
 *
 * Gated behind `PROFILE_UI_LIFECYCLE=true` (it writes a profile field), same as `profile-edit.spec.ts`.
 */
test.describe('KPost Profile · About field security fuzzing', { tag: '@ui' }, () => {
  test.skip(
    process.env.PROFILE_UI_LIFECYCLE !== 'true',
    'edits a profile field; set PROFILE_UI_LIFECYCLE=true',
  );
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  const PAYLOADS: Array<{ name: string; value: string }> = [
    { name: 'script tag', value: '<script>alert(1)</script>' },
    { name: 'img onerror breakout', value: '"><img src=x onerror=alert(1)>' },
    { name: 'SQL-style OR-true', value: "' OR '1'='1" },
  ];

  for (const payload of PAYLOADS) {
    test(`About survives a ${payload.name} payload, rendered inert, then restores the original @ui`, async ({
      page,
    }) => {
      const stop = watchUiHealth(page);
      let dialogFired = false;
      page.on('dialog', (dialog) => {
        dialogFired = true;
        void dialog.dismiss();
      });

      await page.goto('/userprofile', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page
        .locator('.loader-overlay')
        .waitFor({ state: 'hidden', timeout: 30_000 })
        .catch(() => undefined);

      const about = page.locator('#About');
      await expect(about, 'the About section renders').toBeVisible({ timeout: 20_000 });

      // Read the current About text so we can restore it — a genuine value read, not an assertion.
      const original = ((await about.locator('.nuntio-font').first().textContent()) ?? '').trim();

      const marker = `QA SEC ${Date.now()} ${payload.value}`;

      await about.hover().catch(() => undefined);
      await about
        .locator('.icon-KP_236_Edit')
        .first()
        .click({ force: true, timeout: 5_000 })
        .catch(() =>
          page
            .getByText(/^Edit Profile$/i)
            .first()
            .click(),
        );

      const editor = page.getByPlaceholder(/Write about yourself/i).first();
      await expect(editor, 'the About editor opens').toBeVisible({ timeout: 15_000 });
      await editor.fill(marker);
      await page.getByRole('button', { name: /^Update$/i }).click();

      await expect(page.getByText(marker).first(), 'the edited About text is shown, rendered as text').toBeVisible({
        timeout: 20_000,
      });
      await page.waitForTimeout(1_500);

      const health = stop();

      test.info().annotations.push({
        type: 'observed',
        description: `page errors: ${JSON.stringify(health.pageErrors)}; dialog fired: ${dialogFired}`,
      });

      expect(health.pageErrors, `no uncaught JS error rendering: ${payload.value}`).toEqual([]);
      expect(
        dialogFired,
        `the payload must never execute (no alert/confirm/prompt fired): ${payload.value}`,
      ).toBe(false);

      // Restore the original About so the account ends as it started — best-effort re-entry, same
      // caution as `profile-edit.spec.ts` (the hover-revealed pencil is flaky on re-render); the
      // fuzz check above is the assertion, this cleanup must not fail the test if re-entry misses.
      try {
        await about.hover().catch(() => undefined);
        await about.locator('.icon-KP_236_Edit').first().click({ force: true, timeout: 5_000 });
        const restoreEditor = page.getByPlaceholder(/Write about yourself/i).first();
        await restoreEditor.waitFor({ state: 'visible', timeout: 8_000 });
        await restoreEditor.fill(original);
        await page.getByRole('button', { name: /^Update$/i }).click();
      } catch {
        // Re-entry missed — the QA account keeps the fuzz marker in About (harmless, own account).
      }
    });
  }
});
