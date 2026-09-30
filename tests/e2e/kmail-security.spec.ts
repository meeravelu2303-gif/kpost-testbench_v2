import { testData } from '@config/test-data.config';
import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';

/**
 * Security-fuzzing angle for KMail's **compose** Subject + body — a mail actually delivered to a
 * SECOND real account's inbox (our own 2nd QA account), the same high-value "stored payload reaches
 * another real session" reasoning as `katchup-security.spec.ts`. Same execution-based check as the
 * other `*-security.spec.ts` files (a `dialog` listener, not string-matching).
 *
 * Reuses `kmail-compose.spec.ts`'s own proven send flow and selectors (body typed before the To field,
 * since filling To opens a destabilising autocomplete; Subject is `.toInput`; send is
 * `.post_button_size`). Unlike Katchup, KMail has no recall — sending is one-way — so, like
 * `kmail-compose.spec.ts`'s own send test and `settings-security.spec.ts`'s Instant Reply test, this
 * does NOT clean up after itself; each payload leaves one real mail in the 2nd QA account's inbox.
 * Gated behind `KMAIL_UI_LIFECYCLE=true`, same as `kmail-compose.spec.ts`.
 */
test.describe('KPost KMail · compose security fuzzing', { tag: '@ui' }, () => {
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
        dialogFired = true;
        void dialog.dismiss();
      });

      const subject = `QA SEC ${Date.now()} ${payload.value}`;

      await page.goto('/writemail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page
        .locator('.loader-overlay')
        .waitFor({ state: 'hidden', timeout: 30_000 })
        .catch(() => undefined);

      const body = page.locator('.ql-editor[contenteditable="true"]').first();
      await body.click({ force: true });
      await page.keyboard.type(`QA UI security fuzz — ${payload.value}`);

      const to = page.locator('.subjectTextboxKmailTO, input[name="to"]').first();
      await to.click();
      await to.fill(testData.victimKpostId);
      await page
        .getByText(testData.victimKpostId, { exact: false })
        .last()
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
      await page.waitForTimeout(1_500);

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
});
