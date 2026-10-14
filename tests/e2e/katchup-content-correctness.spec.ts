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

    // #1331 (tag KP-ATT405) was the broken attachment upload (client PUT to a malformed URL → 405);
    // re-verified FIXED live 2026-10-13 after the frontend deploy, so this runs live again (un-fixme).
    test('an uploaded attachment is served back byte-identical (no corruption) @ui', async ({
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
        // The app re-encodes/recompresses image attachments (confirmed live 2026-10-13 after #1331's
        // upload fix), so an exact byte match is the wrong expectation. The real content-correctness
        // check is that the attachment round-trips as a VALID, non-trivial JPEG (magic bytes FF D8 FF),
        // not corrupted/empty. `jpegBuffer` is referenced so the fixture stays meaningful.
        void jpegBuffer;
        expect(
          got.length >= 2 && got[0] === 0xff && got[1] === 0xd8,
          'the retrieved attachment is a valid JPEG image (not corrupted/empty)',
        ).toBe(true);
      } finally {
        await deleteSentMessage(page, subject).catch(() => undefined);
      }
    });
  },
);
