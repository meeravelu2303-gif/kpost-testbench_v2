import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { EDITOR, deleteSentMessage, openComposer } from './support/katchup';

/**
 * Coverage gap identified 2026-10-03 (katchup-ground-truth-coverage report, §6 "UI Functional" row):
 * "secret/confidential message UI (real, untested)". Read directly from source
 * (bubble/WriteMessage/WriteMessage.js): the "Secret message" icon opens a "Confidential Message"
 * modal with two options — "Delete After Read" and "Delete as per Schedule" (the latter has an
 * explicit, findable "Done" confirm button with an hours/minutes/seconds picker; the former's confirm
 * mechanism is less clear from source alone, so this test uses the schedule option to keep the
 * completion path unambiguous).
 */
test.describe('KPost Katchup · secret/confidential message UI @ui', { tag: '@ui' }, () => {
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
    await expect(secretIcon, 'the Secret message trigger is available in the composer').toBeVisible(
      {
        timeout: 10_000,
      },
    );
    await secretIcon.click();

    await expect(
      page.getByText('Confidential Message', { exact: true }).first(),
      'the Confidential Message modal opens',
    ).toBeVisible({ timeout: 10_000 });

    // The radio's <label> is a sibling with no `htmlFor` (confirmed in source), so it carries no
    // accessible name via that text — select by the stable `value` attribute instead.
    await page.locator('input[type="radio"][value="DeleteAsPerSchedule"]').check();

    // Schedule a short, real expiry (1 minute) rather than 0 — a 0-duration schedule may be rejected
    // or treated as "no schedule" by the app's own validation.
    await page.locator('select[name="minutes"]').selectOption('1');

    await page.getByRole('button', { name: /^Done$/i }).click();

    // Back in the composer: the modal closes and the secret/confidential indicator should now be
    // active (showSecret=true in source) — send the message to prove the whole flow completes.
    await page.locator(EDITOR).first().click();
    await page.keyboard.press('Enter');

    await expect(
      page.getByText(subject).first(),
      'the confidential message actually sends (completion, not just modal entry)',
    ).toBeVisible({ timeout: 20_000 });

    await deleteSentMessage(page, subject);
  });
});
