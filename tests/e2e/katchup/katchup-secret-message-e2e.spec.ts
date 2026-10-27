import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { EDITOR, deleteSentMessage, openComposer } from '../support/katchup';

/**
 * Katchup composer "Secret message" → Confidential Message modal → Delete as per Schedule, then send.
 * Gated behind KATCHUP_UI_LIFECYCLE; deletes the message.
 */
test.describe(
  'KPost Katchup · secret/confidential message UI @ui',
  { tag: ['@ui', '@katchup', '@regression'] },
  () => {
    test.skip(
      process.env.KATCHUP_UI_LIFECYCLE !== 'true',
      'sends a real message; set KATCHUP_UI_LIFECYCLE=true',
    );
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench') || !testData.victimKpostId,
      'needs both QA accounts',
    );

    test('composing a confidential (delete-as-per-schedule) message completes and sends @ui', async ({
      page,
    }) => {
      const subject = `QA UI secret ${Date.now()}`;
      await openComposer(page);
      await page.getByRole('textbox', { name: 'Subject' }).fill(subject);
      await page.locator(EDITOR).first().click();
      await page.keyboard.type('QA UI confidential message body');

      const secretIcon = page.getByTitle('Secret message').first();
      await expect(
        secretIcon,
        'the Secret message trigger is available in the composer',
      ).toBeVisible({
        timeout: 10_000,
      });
      await secretIcon.click();

      await expect(
        page.getByText('Confidential Message', { exact: true }).first(),
        'the Confidential Message modal opens',
      ).toBeVisible({ timeout: 10_000 });

      // The radio's label has no htmlFor, so it has no accessible name; select by value.
      await page.locator('input[type="radio"][value="DeleteAsPerSchedule"]').check();

      // 1 minute, not 0: a zero schedule may be rejected or treated as "no schedule".
      await page.locator('select[name="minutes"]').selectOption('1');

      await page.getByRole('button', { name: /^Done$/i }).click();

      await page.locator(EDITOR).first().click();
      await page.keyboard.press('Enter');

      await expect(
        page.getByText(subject).first(),
        'the confidential message actually sends (completion, not just modal entry)',
      ).toBeVisible({ timeout: 20_000 });

      await deleteSentMessage(page, subject);
    });
  },
);
