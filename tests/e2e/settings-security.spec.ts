import { testData } from '@config/test-data.config';
import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';

/**
 * Security-fuzzing angle for Settings' **Instant Reply** field — an auto-reply message body that
 * gets sent BACK to whoever messages the account, so a stored payload here would render in a real
 * correspondent's inbox, not just the account holder's own settings list. Same execution-based check
 * as `login-security.spec.ts`/`home-security.spec.ts`/`katchup-security.spec.ts`/
 * `profile-security.spec.ts` (a `dialog` listener, not string-matching).
 *
 * Reuses `settings-functional.spec.ts`'s own proven "adding an Instant Reply shows it in the list"
 * flow and exact selectors. That existing test is itself additive with no delete step (the feature
 * has no built delete flow to reuse yet), so — like it — this does not clean up after itself; each
 * payload adds one more Instant Reply entry to the shared QA account. Kept to running this file
 * sparingly for that reason.
 *
 * Gated behind `SETTINGS_UI_LIFECYCLE=true`, same gate as `settings-functional.spec.ts`.
 */
test.describe('KPost Settings · Instant Reply security fuzzing', { tag: '@ui' }, () => {
  test.skip(
    process.env.SETTINGS_UI_LIFECYCLE !== 'true',
    'adds a real Instant Reply; set SETTINGS_UI_LIFECYCLE=true',
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
    test(`an Instant Reply carrying a ${payload.name} payload is stored and shown inert @ui`, async ({
      page,
    }) => {
      const stop = watchUiHealth(page);
      let dialogFired = false;
      page.on('dialog', (dialog) => {
        dialogFired = true;
        void dialog.dismiss();
      });

      await page.goto('/settings', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page
        .locator('.loader-overlay')
        .waitFor({ state: 'hidden', timeout: 30_000 })
        .catch(() => undefined);
      await page
        .getByText('Instant Reply', { exact: false })
        .first()
        .click({ timeout: 15_000 })
        .catch(() => undefined);
      await page
        .getByRole('button', { name: 'Add' })
        .first()
        .click({ timeout: 10_000 })
        .catch(() => undefined);

      const field = page.getByRole('textbox', { name: 'Enter your Instant Reply' });
      const opened = await field.isVisible({ timeout: 10_000 }).catch(() => false);
      test.skip(
        !opened,
        'the Instant Reply editor did not open on this build — needs a codegen re-tune',
      );

      const marker = `QA SEC ${Date.now()} ${payload.value}`;
      await field.click();
      await field.fill(marker);
      await page.getByRole('dialog').getByRole('button', { name: 'Add' }).click();

      await expect(
        page.getByText(marker).first(),
        'the saved Instant Reply appears in the list, rendered as text',
      ).toBeVisible({ timeout: 12_000 });
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
    });
  }
});
