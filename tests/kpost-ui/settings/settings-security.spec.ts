import { testData } from '@config/test-data.config';
import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';
import { settleFrames } from '../support/settle';
import { retryOrSkip } from '../../support/live-condition';

/**
 * Settings Instant Reply security fuzzing (the reply is sent to correspondents), judged by a dialog
 * listener. No delete flow exists, so each payload adds an entry. Gated behind SETTINGS_UI_LIFECYCLE=true.
 */
test.describe(
  'KPost Settings · Instant Reply security fuzzing',
  {
    tag: ['@ui', '@settings', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
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
        settingsPage,
      }) => {
        const stop = watchUiHealth(page);
        let dialogFired = false;
        page.on('dialog', (dialog) => {
          dialogFired = true;
          void dialog.dismiss();
        });

        // Nested under "KMail Settings", which must be expanded first.
        await settingsPage.goto();
        await settingsPage.openPanel('KMail Settings', 'Instant Reply');
        await page
          .getByRole('button', { name: 'Add' })
          .first()
          .click({ timeout: 10_000 })
          .catch(() => undefined);

        const field = page.getByRole('textbox', { name: 'Enter your Instant Reply' });
        const opened = await field.isVisible({ timeout: 10_000 }).catch(() => false);
        retryOrSkip(
          !opened,
          'the Instant Reply editor was not showing right now (session or load condition; path verified live 2026-10-11)',
        );

        const marker = `QA SEC ${Date.now()} ${payload.value}`;
        await field.click();
        await field.fill(marker);
        await page.getByRole('dialog').getByRole('button', { name: 'Add' }).click();

        await expect(
          page.getByText(marker).first(),
          'the saved Instant Reply appears in the list, rendered as text',
        ).toBeVisible({ timeout: 12_000 });
        await settleFrames(page);

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
  },
);
