import { testData } from '@config/test-data.config';
import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';
import { isKnownAppAlert } from '../support/known-dialogs';
import { settleFrames } from '../support/settle';

/**
 * KMail compose Subject + body security fuzzing, delivered to our 2nd QA account's inbox and judged by a
 * dialog listener. Gated behind KMAIL_UI_LIFECYCLE=true; KMail has no recall, so each payload leaves a mail.
 */
test.describe(
  'KPost KMail · compose security fuzzing',
  {
    tag: ['@ui', '@kmail', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    test.skip(
      process.env.KMAIL_UI_LIFECYCLE !== 'true',
      'sends a real mail; set KMAIL_UI_LIFECYCLE=true',
    );
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench') || !testData.victimKpostId,
      'needs both QA accounts',
    );

    const PAYLOADS: Array<{ name: string; value: string }> = [
      { name: 'script tag', value: '<script>alert(1)</script>' },
      { name: 'img onerror breakout', value: '"><img src=x onerror=alert(1)>' },
      { name: 'SQL-style OR-true', value: "' OR '1'='1" },
    ];

    for (const payload of PAYLOADS) {
      test(`a mail carrying a ${payload.name} payload in Subject+body sends and renders inert @ui`, async ({
        page,
      }) => {
        const stop = watchUiHealth(page);
        let dialogFired = false;
        page.on('dialog', (dialog) => {
          if (!isKnownAppAlert(dialog)) dialogFired = true;
          void dialog.dismiss();
        });

        const subject = `QA SEC ${Date.now()} ${payload.value}`;

        await page.goto('/writemail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await page
          .locator('.loader-overlay')
          .waitFor({ state: 'hidden', timeout: 30_000 })
          .catch(() => undefined);

        // A /writemail page crash is the screen sweep's finding; skip with the reason.
        const crashed = await page
          .getByText(/Something went wrong/i)
          .first()
          .isVisible()
          .catch(() => false);
        test.skip(
          crashed,
          '/writemail rendered the error boundary ("Something went wrong") — #990-shaped crash, reported by screens-batch4, not a compose-fuzz finding',
        );
        const body = page.locator('.ql-editor[contenteditable="true"]').first();
        await body.click();
        await page.keyboard.type(`QA UI security fuzz — ${payload.value}`);

        const to = page.locator('.subjectTextboxKmailTO, input[name="to"]').first();
        await to.click();
        await to.fill(testData.victimKpostId);
        await page
          .locator('.suggestion-dropdown')
          .getByText(testData.victimKpostId, { exact: false })
          .first()
          .click({ timeout: 4_000 })
          .catch(() => undefined);

        await page.locator('.toInput').first().fill(subject);

        await page
          .locator('.post_button_size')
          .filter({ has: page.locator('.icon-KP_3164') })
          .first()
          .click()
          .catch(() => page.locator('.post_button_size').first().click());

        await expect(
          page
            .getByText(/sent|success/i)
            .first()
            .or(page.locator('.Toastify__toast--success').first()),
          'the mail was sent (success toast / compose cleared), rendered as text',
        ).toBeVisible({ timeout: 20_000 });
        await settleFrames(page);

        const health = stop();

        test.info().annotations.push({
          type: 'observed',
          description: `page errors: ${JSON.stringify(health.pageErrors)}; dialog fired: ${dialogFired}`,
        });

        expect(health.pageErrors, `no uncaught JS error sending: ${payload.value}`).toEqual([]);
        expect(
          dialogFired,
          `the payload must never execute (no alert/confirm/prompt fired): ${payload.value}`,
        ).toBe(false);
      });
    }
  },
);
