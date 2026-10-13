import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import {
  EDITOR,
  deleteSentMessage,
  messageBySubject,
  openComposerFor,
  sendMessage,
} from './support/katchup';

/**
 * Katchup **content correctness** (FRD row 13) from the send path: a message body must round-trip
 * unchanged for non-ASCII content — Indian-language text (Tamil, Hindi), emoji, and a long body —
 * not mojibake, `?` replacement characters, or silent truncation.
 *
 * Reuses the shared, live-validated compose helpers (`openComposerFor`/`sendMessage`/`deleteSentMessage`),
 * which TYPE into the Quill editor (never `.fill()`), so Unicode is entered the way a real keyboard
 * would. Each test self-cleans (deletes the message it sent) and is gated behind KATCHUP_UI_LIFECYCLE
 * like every write flow. The ASCII `marker` is the Subject (reliable to locate); the assertion is on
 * the non-ASCII BODY rendering unchanged.
 */
test.describe(
  'KPost Katchup · content correctness (Tamil/Hindi, emoji, long body)',
  { tag: ['@ui', '@katchup', '@regression'] },
  () => {
    test.skip(
      process.env.KATCHUP_UI_LIFECYCLE !== 'true',
      'sends real messages; set KATCHUP_UI_LIFECYCLE=true',
    );
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench') || !testData.victimKpostId,
      'needs both QA accounts (QA_KPOST_ID, QA_VICTIM_KPOST_ID)',
    );

    test('Tamil and Hindi text in a message body round-trips unchanged @ui', async ({ page }) => {
      const marker = `QA i18n ${Date.now()}`;
      const tamil = 'வணக்கம் உலகம்'; // "Hello world" (Tamil)
      const hindi = 'नमस्ते दुनिया'; // "Hello world" (Hindi)
      try {
        await openComposerFor(page, testData.victimKpostId);
        await sendMessage(page, marker, `${tamil} | ${hindi}`);
        const msg = messageBySubject(page, marker);
        await expect(
          msg,
          'the sent message renders the Tamil text unchanged (no mojibake / ? replacement)',
        ).toContainText(tamil);
        await expect(msg, 'the sent message renders the Hindi text unchanged').toContainText(hindi);
      } finally {
        await deleteSentMessage(page, marker).catch(() => undefined);
      }
    });

    test('emoji in a message body render unchanged @ui', async ({ page }) => {
      const marker = `QA emoji ${Date.now()}`;
      const emoji = '😀🎉👍';
      try {
        await openComposerFor(page, testData.victimKpostId);
        await sendMessage(page, marker, `emoji check ${emoji} end`);
        await expect(
          messageBySubject(page, marker),
          'the sent message renders the emoji unchanged (not stripped or turned into ?)',
        ).toContainText(emoji);
      } finally {
        await deleteSentMessage(page, marker).catch(() => undefined);
      }
    });

    test('a long message body is accepted and stored without truncation @ui', async ({ page }) => {
      const marker = `QA long ${Date.now()}`;
      // ~520-char body with a distinctive tail token: if the stored message still carries the tail,
      // the full body was accepted (not silently truncated part-way through).
      const tail = `END-${Date.now()}`;
      const body = `${'kpost-content-correctness '.repeat(20)}${tail}`;
      try {
        await openComposerFor(page, testData.victimKpostId);
        await sendMessage(page, marker, body);
        await expect(
          messageBySubject(page, marker),
          'the long body is stored intact — its tail token survives (no silent truncation)',
        ).toContainText(tail);
      } finally {
        await deleteSentMessage(page, marker).catch(() => undefined);
      }
    });

    // KNOWN OPEN BUG #1331 (tag KP-ATT405, filed 2026-10-13): Katchup attachment upload is broken.
    // generate-presigned-url returns 200 with {"presignedURL":"https://kpostdrive.s3.../..."}, but the
    // client then PUTs the file to `https://test.kpostindia.com/{"presignedURL":"https://..."}` — it uses
    // the whole JSON response envelope as the upload URL instead of reading the presignedURL field — so
    // the S3 PUT 405s, the upload never completes, "Done" never enables, and no file can be attached.
    // Byte-integrity cannot be asserted until uploads work; this stays fixme (does not fail the suite)
    // and flips to a live test the moment the upload path is fixed. Reproduces here AND in
    // katchup-attach-send-e2e. The assertions below encode the correct behaviour (upload completes,
    // served bytes identical) so no rewrite is needed on fix — just remove this fixme.
    test.fixme('an uploaded attachment is served back byte-identical (no corruption) @ui', async ({
      page,
    }) => {
      const subject = `QA attach-integrity ${Date.now()}`;
      // A tiny real 1x1 JPEG (same fixture the attach-send E2E uses). Small enough that the app has no
      // reason to down-scale it, so the served attachment should be the uploaded bytes verbatim.
      const jpegBuffer = Buffer.from(
        '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=',
        'base64',
      );
      try {
        await openComposerFor(page, testData.victimKpostId);
        await page.getByRole('textbox', { name: 'Subject' }).fill(subject);
        await page.locator(EDITOR).first().click();
        await page.keyboard.type('attachment integrity check');

        await page.locator('#fileInput').setInputFiles({
          name: 'qa-integrity.jpg',
          mimeType: 'image/jpeg',
          buffer: jpegBuffer,
        });
        const done = page.getByRole('button', { name: /^Done$/i });
        await expect(done, 'the attachment modal appears').toBeVisible({ timeout: 15_000 });
        await expect(done, 'Done enables once the presigned upload completes').toBeEnabled({
          timeout: 30_000,
        });
        await done.click();
        await page.locator(EDITOR).first().click();
        await page.keyboard.press('Enter');

        const sent = messageBySubject(page, subject);
        await expect(sent, 'the message with its attachment appears in the thread').toBeVisible({
          timeout: 20_000,
        });
        const thumb = sent.locator('img').first();
        await expect(thumb, 'the attachment thumbnail renders').toBeVisible({ timeout: 10_000 });

        await expect(thumb, 'the rendered attachment has a source URL').toHaveAttribute(
          'src',
          /\S/,
        );
        const src = (await thumb.getAttribute('src')) ?? '';
        let got: Buffer;
        if (src.startsWith('data:')) {
          got = Buffer.from(src.split(',', 2)[1] ?? '', 'base64');
        } else {
          // The browser already loaded this URL into an <img> (no auth header), so it is fetchable.
          const resp = await page.request.get(src);
          expect(
            resp.ok(),
            `the stored attachment is retrievable (HTTP ${resp.status()})`,
          ).toBeTruthy();
          got = await resp.body();
        }
        expect(got.length, 'the retrieved attachment is non-empty').toBeGreaterThan(0);
        expect(
          got.equals(jpegBuffer),
          'the retrieved attachment is byte-identical to the uploaded file (no corruption or re-encode)',
        ).toBe(true);
      } finally {
        await deleteSentMessage(page, subject).catch(() => undefined);
      }
    });
  },
);
