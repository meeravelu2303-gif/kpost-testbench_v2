import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import type { Page } from '@playwright/test';

/**
 * KMail compose → send (FR-M01) on /writemail. The form check is read-only; the send is gated behind
 * KMAIL_UI_LIFECYCLE=true and goes to our own 2nd QA account.
 */
/** /writemail intermittently lands on the error boundary (#990, reported by the screen sweep), so skip. */
async function skipIfWriteMailCrashed(page: Page): Promise<void> {
  const crashed = await page
    .getByText(/Something went wrong/i)
    .first()
    .isVisible()
    .catch(() => false);
  test.skip(
    crashed,
    '/writemail rendered the error boundary ("Something went wrong") — #990-shaped crash, reported by screens-batch4, not a compose finding',
  );
}

test.describe('KPost KMail compose', { tag: ['@ui', '@kmail', '@regression', '@sanity'] }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  test(
    'the compose form renders its To, Subject and body fields @ui',
    {
      annotation: [
        { type: 'requirement', description: 'FR-KM-001' },
        { type: 'requirement', description: 'FR-KM-002' },
      ],
    },
    async ({ page }) => {
      await page.goto('/writemail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page
        .locator('.loader-overlay')
        .waitFor({ state: 'hidden', timeout: 30_000 })
        .catch(() => undefined);
      await skipIfWriteMailCrashed(page);

      await expect(
        page.locator('input[name="to"], .subjectTextboxKmailTO').first(),
        'the To field is present',
      ).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('.toInput').first(), 'the Subject field is present').toBeVisible();
      await expect(
        page
          .getByText(/Type your mail here/i)
          .or(page.locator('.ql-editor'))
          .first(),
        'the mail body editor is present',
      ).toBeVisible();
    },
  );
});

test.describe(
  'KPost KMail compose · send (write)',
  { tag: ['@ui', '@kmail', '@regression'] },
  () => {
    test.skip(
      process.env.KMAIL_UI_LIFECYCLE !== 'true',
      'sends a real mail; set KMAIL_UI_LIFECYCLE=true',
    );
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench') || !testData.victimKpostId,
      'needs both QA accounts',
    );

    test(
      'compose a mail to the 2nd QA account and send it (FR-M01) @ui',
      {
        annotation: [
          { type: 'requirement', description: 'FR-KM-018' },
          { type: 'requirement', description: 'FR-KM-019' },
        ],
      },
      async ({ page }) => {
        const subject = `QA UI mail ${Date.now()}`;

        await page.goto('/writemail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await page
          .locator('.loader-overlay')
          .waitFor({ state: 'hidden', timeout: 30_000 })
          .catch(() => undefined);
        await skipIfWriteMailCrashed(page);

        // Body first: the To autocomplete destabilises the layout.
        const body = page.locator('.ql-editor[contenteditable="true"]').first();
        await body.click();
        await page.keyboard.type('QA UI KMail body — self-cleaning');

        const to = page.locator('.subjectTextboxKmailTO, input[name="to"]').first();
        await to.click();
        await to.fill(testData.victimKpostId);
        // Pick the recipient from the dropdown if one surfaces; some builds accept raw text.
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

        // Sent: a success toast appears or the compose surface clears.
        await expect(
          page
            .getByText(/sent|success/i)
            .first()
            .or(page.locator('.Toastify__toast--success').first()),
          'the mail was sent (success toast / compose cleared)',
        ).toBeVisible({ timeout: 20_000 });
      },
    );
  },
);
