import { testData } from '@config/test-data.config';
import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';

/**
 * Security-fuzzing angle for Kall's two free-text fields — the main screen's contact search box
 * (client-side filter, self-only) and the CreateKallModal's Meeting Title field. Same execution-based
 * check as `login-security.spec.ts`/`home-security.spec.ts`/`contacts-security.spec.ts` (a `dialog`
 * listener, not string-matching).
 *
 * Neither field is ever actually submitted here: direct calling rings a real device (assert-only, per
 * `kall-features.spec.ts`), and the Kool Kall schedule form's Submit is blocked on a codegen-pending
 * participant-picker step (documented in that same file) — so this only fills and reads back each
 * field's own value, exactly like that file's own "the fields hold their values" assertion, never
 * reaching a real write. No lifecycle gate needed as a result.
 */
test.describe('KPost Kall · contact search box security fuzzing', { tag: '@ui' }, () => {
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
    test(`the Kall contact search box survives a ${payload.name} payload without crashing or executing it @ui`, async ({
      page,
    }) => {
      const stop = watchUiHealth(page);
      let dialogFired = false;
      page.on('dialog', (dialog) => {
        dialogFired = true;
        void dialog.dismiss();
      });

      await page.goto('/kall', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page
        .locator('.loader-overlay')
        .waitFor({ state: 'hidden', timeout: 30_000 })
        .catch(() => undefined);

      // Found live 2026-10-01: the real placeholder is just "Search", not "Search Contacts" as
      // previously assumed (confirmed via screenshot) — a bench selector gap, not a product defect.
      const search = page.getByPlaceholder(/^search$/i).first();
      await expect(search, 'the contact search box is present').toBeVisible({ timeout: 20_000 });
      await search.click();
      await search.fill(payload.value);
      await page.waitForTimeout(1_500);

      const health = stop();

      test.info().annotations.push({
        type: 'observed',
        description: `page errors: ${JSON.stringify(health.pageErrors)}; dialog fired: ${dialogFired}`,
      });

      expect(health.pageErrors, `no uncaught JS error while filtering by: ${payload.value}`).toEqual([]);
      expect(
        dialogFired,
        `the payload must never execute (no alert/confirm/prompt fired): ${payload.value}`,
      ).toBe(false);
    });
  }
});

test.describe('KPost Kall · Meeting Title field security fuzzing', { tag: '@ui' }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  const PAYLOADS: Array<{ name: string; value: string }> = [
    { name: 'script tag', value: '<script>alert(1)</script>' },
    { name: 'img onerror breakout', value: '"><img src=x onerror=alert(1)>' },
  ];

  for (const payload of PAYLOADS) {
    test(`the Meeting Title field survives a ${payload.name} payload without crashing or executing it @ui`, async ({
      page,
    }) => {
      const stop = watchUiHealth(page);
      let dialogFired = false;
      page.on('dialog', (dialog) => {
        dialogFired = true;
        void dialog.dismiss();
      });

      await page.goto('/kall', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page
        .locator('.loader-overlay')
        .waitFor({ state: 'hidden', timeout: 30_000 })
        .catch(() => undefined);
      await page
        .getByRole('button', { name: /Kool Kall/i })
        .first()
        .click()
        .catch(() => undefined);

      const modal = page.locator('.modal-content');
      const titleField = modal.locator('input[placeholder="Enter Meeting Title"]').first();
      const createBtn = page.locator('.create_font').first();
      await expect(createBtn, 'the Create control is present on the Kool Kall tab').toBeVisible({
        timeout: 20_000,
      });
      await createBtn.click({ force: true });
      if (!(await titleField.isVisible().catch(() => false))) {
        await createBtn.click({ force: true });
      }
      const opened = await titleField.isVisible({ timeout: 15_000 }).catch(() => false);
      test.skip(!opened, 'the schedule modal did not open on this build — needs a codegen re-tune');

      await titleField.fill(payload.value);
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
      await expect(titleField, 'the field holds the raw text, unmodified').toHaveValue(payload.value);
    });
  }
});
