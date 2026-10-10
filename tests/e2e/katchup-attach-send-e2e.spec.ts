import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { EDITOR, deleteSentMessage, openComposer } from './support/katchup';

/**
 * E2E coverage gap identified 2026-10-03 (katchup-ground-truth-coverage report, §6 "E2E" row):
 * no existing UI test drives the real compose -> attach -> upload -> send -> thread-render flow.
 * `attachment-workflow.spec.ts` (API) proves the backend accepts a presigned-upload attachment;
 * this proves the ACTUAL UI wiring works end to end — file picker -> presigned upload -> attachment
 * preview -> send -> the sent message renders with its attachment in the thread.
 *
 * Selectors confirmed by reading the live source directly (src/components/Katchup/components/
 * WriteMessage/WriteMessage.js): the hidden file input is `#fileInput` (accepts `multiple`, no
 * `accept` filter); each selected file is uploaded via a presigned URL and gets a `uuid` once done;
 * the attachment modal's "Done" button stays disabled until every file has a `uuid`.
 */
test.describe('KPost Katchup · attach-and-send E2E @ui', { tag: '@ui' }, () => {
  test.skip(
    process.env.KATCHUP_UI_LIFECYCLE !== 'true',
    'drives a real presigned upload + send; set KATCHUP_UI_LIFECYCLE=true',
  );
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench') || !testData.victimKpostId,
    'needs both QA accounts',
  );

  test('compose, attach a real file, send, and the thread renders it @ui', async ({ page }) => {
    const subject = `QA attach-e2e ${Date.now()}`;
    await openComposer(page);

    await page.getByRole('textbox', { name: 'Subject' }).fill(subject);
    await page.locator(EDITOR).first().click();
    await page.keyboard.type('QA attach-send E2E body');

    // A tiny real JPEG (1x1 pixel) — small enough to upload fast, large enough to be a real file.
    const jpegBuffer = Buffer.from(
      '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=',
      'base64',
    );
    await page.locator('#fileInput').setInputFiles({
      name: 'qa-e2e-attach.jpg',
      mimeType: 'image/jpeg',
      buffer: jpegBuffer,
    });

    // The "Done" button is disabled until the presigned upload finishes and the file gets a uuid.
    const doneButton = page.getByRole('button', { name: /^Done$/i });
    await expect(
      doneButton,
      'the attachment modal appears with Done initially disabled or pending upload',
    ).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      doneButton,
      'Done becomes enabled once the presigned upload completes',
    ).toBeEnabled({
      timeout: 30_000,
    });
    await doneButton.click();

    // The editor loses focus once the attachment modal closes — re-focus it before submitting,
    // otherwise Enter is captured by whatever element the modal's close left focused instead
    // (confirmed live: without this, Enter navigated away from the thread entirely).
    await page.locator(EDITOR).first().click();
    await page.keyboard.press('Enter');

    const sent = page
      .locator('[id]')
      .filter({ hasText: subject })
      .filter({ has: page.getByTestId('NotificationsNoneIcon') })
      .last();
    await expect(sent, 'the sent message with its attachment appears in the thread').toBeVisible({
      timeout: 20_000,
    });

    // The thread render includes a real attachment element (an image thumbnail), not just the text.
    const attachmentThumb = sent.locator('img').first();
    await expect(
      attachmentThumb,
      'the sent message renders an attachment thumbnail, not just the text body',
    ).toBeVisible({ timeout: 10_000 });

    await deleteSentMessage(page, subject);
  });
});
