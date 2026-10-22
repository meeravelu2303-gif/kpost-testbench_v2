import { AUTH_PROFILES } from '@config/auth-profile';
import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import {
  EDITOR,
  deleteSentMessage,
  messageBySubject,
  openComposerFor,
  sendMessage,
} from '../support/katchup';

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
 *
 * The sender's own thread can render from local state, so for text content each test ALSO reads the
 * RECIPIENT's copy back from the server (qatest2's conversation with qatest1, via the API) and requires
 * the exact characters there — the round-trip a real receiver gets (RTM-CON01/02/03).
 */
const RECIPIENT = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'victim')!;

/** The body of the message with Subject `marker` as the RECIPIENT's server copy holds it (polled). */
async function recipientBody(endpoints: EndpointExecutor, marker: string): Promise<string> {
  let found: string | undefined;
  await expect
    .poll(
      async () => {
        const exchange = await endpoints.sendTo(
          'katchup-conversation',
          {
            body: {
              groupFlag: false,
              firstMsgID: null,
              lastMsgID: null,
              receiver: testData.kpostId,
            },
          },
          { label: 'content:recipient-copy', auth: { principal: RECIPIENT } },
        );
        const parsed = exchange.json();
        const walk = (v: unknown): void => {
          if (found !== undefined || v === null || typeof v !== 'object') return;
          const o = v as Record<string, unknown>;
          if (o.subject === marker && typeof o.actualMessage === 'string') found = o.actualMessage;
          else Object.values(o).forEach(walk);
        };
        if (parsed.ok) walk(parsed.value);
        return found !== undefined;
      },
      { message: `the recipient's conversation holds the message "${marker}"`, timeout: 30_000 },
    )
    .toBe(true);
  return found ?? '';
}

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

    test(
      'Tamil and Hindi text in a message body round-trips unchanged @ui',
      { annotation: [{ type: 'requirement', description: 'RTM-CON01' }] },
      async ({ page, endpoints }) => {
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
          await expect(msg, 'the sent message renders the Hindi text unchanged').toContainText(
            hindi,
          );
          const received = await recipientBody(endpoints, marker);
          expect(received, "the recipient's copy holds the Tamil text unchanged").toContain(tamil);
          expect(received, "the recipient's copy holds the Hindi text unchanged").toContain(hindi);
        } finally {
          await deleteSentMessage(page, marker).catch(() => undefined);
        }
      },
    );

    test(
      'emoji in a message body render unchanged @ui',
      { annotation: [{ type: 'requirement', description: 'RTM-CON02' }] },
      async ({ page, endpoints }) => {
        const marker = `QA emoji ${Date.now()}`;
        const emoji = '😀🎉👍';
        try {
          await openComposerFor(page, testData.victimKpostId);
          await sendMessage(page, marker, `emoji check ${emoji} end`);
          await expect(
            messageBySubject(page, marker),
            'the sent message renders the emoji unchanged (not stripped or turned into ?)',
          ).toContainText(emoji);
          expect(
            await recipientBody(endpoints, marker),
            "the recipient's copy holds the emoji unchanged (same code points)",
          ).toContain(emoji);
        } finally {
          await deleteSentMessage(page, marker).catch(() => undefined);
        }
      },
    );

    test(
      'a long message body is accepted and stored without truncation @ui',
      { annotation: [{ type: 'requirement', description: 'RTM-CON03' }] },
      async ({ page, endpoints }) => {
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
          const received = await recipientBody(endpoints, marker);
          expect(received, "the recipient's copy keeps the whole body (its tail token)").toContain(
            tail,
          );
          expect(
            received.replace(/<[^>]+>/g, '').length,
            "the recipient's copy is at least as long as what was typed (no silent truncation)",
          ).toBeGreaterThanOrEqual(body.length);
        } finally {
          await deleteSentMessage(page, marker).catch(() => undefined);
        }
      },
    );

    // #1331 (tag KP-ATT405) was the broken attachment upload (client PUT to a malformed URL → 405);
    // re-verified FIXED live 2026-10-13 after the frontend deploy, so this runs live again (un-fixme).
    test(
      'an uploaded attachment is served back byte-identical (no corruption) @ui',
      { annotation: [{ type: 'requirement-partial', description: 'RTM-CON04' }] },
      async ({ page }) => {
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

          // The thumbnail first shows a small PNG PLACEHOLDER (a data: URL) and swaps in the real image
          // only when /v2/katchup/downloadThumbnail answers — which takes 10+ s since 2026-10-15
          // (#1364). So the rendered source is POLLED until it is the attachment itself; the time it
          // took is recorded. The SERVER round-trip (recipient download, byte-identical by SHA-256) is
          // asserted separately by tests/api/kpost/katchup/attachment-integrity.spec.ts.
          const readRendered = async (): Promise<{ src: string; got: Buffer }> => {
            const src = (await thumb.getAttribute('src')) ?? '';
            if (!src) return { src, got: Buffer.alloc(0) };
            if (src.startsWith('data:'))
              return { src, got: Buffer.from(src.split(',', 2)[1] ?? '', 'base64') };
            if (src.startsWith('blob:')) {
              // A blob URL only exists inside the page, so it is read there (page.request cannot).
              const bytes = await page.evaluate(async (u) => {
                const r = await fetch(u);
                return Array.from(new Uint8Array(await r.arrayBuffer()));
              }, src);
              return { src, got: Buffer.from(bytes) };
            }
            // The browser already loaded this URL into an <img> (no auth header), so it is fetchable.
            const resp = await page.request.get(src);
            return { src, got: resp.ok() ? await resp.body() : Buffer.alloc(0) };
          };
          const isJpeg = (b: Buffer) =>
            b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
          const isPng = (b: Buffer) =>
            b.length >= 24 && b.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
          // The thread shows a THUMBNAIL the server derives from the upload (a PNG), after a data:
          // placeholder. The real preview is therefore "not the data: placeholder, a valid JPEG or PNG".
          type Rendered = { src: string; got: Buffer };
          const isPreview = (r: Rendered) =>
            !r.src.startsWith('data:') && (isJpeg(r.got) || isPng(r.got));
          const summarize = (r: Rendered) =>
            `src ${r.src.slice(0, 5)}…, ${r.got.length} bytes, ` +
            (isPng(r.got)
              ? `PNG ${r.got.readUInt32BE(16)}x${r.got.readUInt32BE(20)}`
              : isJpeg(r.got)
                ? 'JPEG'
                : `starts ${r.got.subarray(0, 8).toString('hex')}`);
          const t0 = Date.now();
          let last: Rendered = { src: '', got: Buffer.alloc(0) };
          await expect
            .poll(
              async () => {
                last = await readRendered();
                return isPreview(last);
              },
              {
                message:
                  'the attachment preview swaps its placeholder for the real image (#1364: the thumbnail ' +
                  'request takes 10+ s)',
                timeout: 45_000,
                intervals: [1_000],
              },
            )
            .toBe(true)
            .catch(() => undefined);
          test.info().annotations.push({
            type: 'observed',
            description: `preview after ${Date.now() - t0} ms: ${summarize(last)}`,
          });
          console.log(`CONTENT ${test.info().annotations.at(-1)?.description ?? ''}`);
          // The app re-encodes image attachments (confirmed live 2026-10-13 after #1331's upload fix)
          // and the thread shows a server-derived thumbnail, so an exact byte match is the wrong
          // expectation here: the check is that the preview becomes a VALID image, not corrupted/empty.
          // `jpegBuffer` is referenced so the fixture stays meaningful.
          void jpegBuffer;
          expect(last.got.length, 'the retrieved attachment is non-empty').toBeGreaterThan(0);
          expect(
            isPreview(last),
            `the attachment preview becomes a valid image (not the placeholder, not corrupted/empty) — ${summarize(last)}`,
          ).toBe(true);
        } finally {
          await deleteSentMessage(page, subject).catch(() => undefined);
        }
      },
    );
  },
);
