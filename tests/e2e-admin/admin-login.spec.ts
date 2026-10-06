import { env } from '@config/env';
import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';

/**
 * Admin HR-Setup's OWN login screen (`Login.js`, `/login`) — a full KPOST-ID/mobile+password flow
 * with its own forgot-password OTP flow. Confirmed from the 2026-10-05 frontend ground-truth audit
 * to have ZERO existing test coverage: the bench's SSO setup (`auth-admin.setup.ts`) always seeds
 * the session via the `Callback.js` token hand-off instead, so this screen — the one a real admin
 * actually sees and uses whenever that SSO hand-off doesn't happen — has never been exercised.
 *
 * Uses a clean, unauthenticated context (no planted SSO token) so the real login form is reachable,
 * the same way a real first-time visitor would see it.
 */
test.describe('Admin/HR-Setup Login screen', { tag: '@admin-ui' }, () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.skip(!env.ADMIN_UI_BASE_URL, 'needs a configured admin host');

  test('loads with the KPOST ID / mobile field and an enabled Submit once typed @ui', async ({
    page,
  }) => {
    await page.goto('/login', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    const field = page.getByPlaceholder('Enter KPOST ID / Mobile number');
    await expect(field, 'the login-id field is visible').toBeVisible({ timeout: 20_000 });

    const submit = page.getByRole('button', { name: /^Submit$/i });
    await expect(submit, 'Submit starts disabled with no input').toBeDisabled();

    await field.fill('qa-bench-nonexistent-id@kpost.in');
    await expect(submit, 'Submit becomes enabled once something is typed').toBeEnabled({
      timeout: 10_000,
    });
  });

  test('a non-existent KPOST ID shows an error toast, not a crash @ui', async ({ page }) => {
    const stop = watchUiHealth(page);
    await page.goto('/login', { waitUntil: 'domcontentloaded', timeout: 45_000 });

    const field = page.getByPlaceholder('Enter KPOST ID / Mobile number');
    await field.fill(`qa-bench-nonexistent-${Date.now()}@kpost.in`);
    await page.getByRole('button', { name: /^Submit$/i }).click();

    await expect(
      page.getByText(/doesn't exist|Enter a Valid/i).first(),
      'a clear error is shown for an unknown KPOST ID',
    ).toBeVisible({ timeout: 15_000 });

    const health = stop();
    expect(health.pageErrors, 'no uncaught JS error on an unknown KPOST ID').toEqual([]);
  });

  test('the login-id field survives XSS/SQLi payloads without executing them @ui', async ({
    page,
  }) => {
    const PAYLOADS = [
      { name: 'script tag', value: '<script>alert(1)</script>' },
      { name: 'img onerror breakout', value: '"><img src=x onerror=alert(1)>' },
      { name: 'SQL-style OR-true', value: "' OR '1'='1" },
    ];

    for (const payload of PAYLOADS) {
      const stop = watchUiHealth(page);
      let dialogFired = false;
      page.on('dialog', (dialog) => {
        dialogFired = true;
        void dialog.dismiss();
      });

      await page.goto('/login', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      const field = page.getByPlaceholder('Enter KPOST ID / Mobile number');
      await field.fill(payload.value);
      await page.getByRole('button', { name: /^Submit$/i }).click().catch(() => undefined);
      await page.waitForTimeout(1_500);

      const health = stop();
      expect(health.pageErrors, `no uncaught JS error submitting: ${payload.value}`).toEqual([]);
      expect(
        dialogFired,
        `the payload must never execute (no alert/confirm/prompt fired): ${payload.value}`,
      ).toBe(false);
    }
  });
});
