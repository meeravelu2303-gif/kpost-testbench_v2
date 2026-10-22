import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import type { Page, Request, Response } from '@playwright/test';
import { settleFrames } from './support/settle';

/**
 * KMail · attach a file in the compose screen and send it (the real browser path).
 *
 * Why: no UI test attached a file in KMail. The API-level attachment spec builds its own upload, so a
 * broken upload in the web app itself would go unnoticed.
 *
 * Source (WriteMailPage.js, Services/Kmail.js — the live KMail compose):
 *   - picking a file (`#fileInput` → handleSelectedFile) asks `POST /v2/aws/generate-presigned-url`
 *     for an upload link, then PUTs the file to that link (axios.put(signedUrl, file));
 *   - `GeneratePreSignedURL` returns the raw response TEXT and uses it as the link. Live 2026-10-14
 *     that endpoint answers with a JSON wrapper (`{"presignedURL":"https://…","status":"SUCCESS",…}`)
 *     instead of a bare link, and unlike Katchup (normalizeSignedUrl) KMail never unwraps it — so the
 *     upload could be sent to an invalid address. This test records the upload-link response and the
 *     real upload request, then asserts the correct behaviour: the file is uploaded to an https
 *     storage address, the attachment window's Done enables, and the sent mail carries the file.
 */
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=',
  'base64',
);

test.describe(
  'KPost KMail · attach and send from the compose screen @ui',
  { tag: ['@ui', '@kmail', '@regression'] },
  () => {
    test.describe.configure({ timeout: 120_000 });
    test.skip(
      process.env.KMAIL_UI_LIFECYCLE !== 'true',
      'uploads a file and sends a real mail; set KMAIL_UI_LIFECYCLE=true',
    );
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench') || !testData.victimKpostId,
      'needs both QA accounts',
    );

    async function openCompose(page: Page): Promise<void> {
      await page.goto('/writemail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page
        .locator('.loader-overlay')
        .waitFor({ state: 'hidden', timeout: 30_000 })
        .catch(() => undefined);
      await expect(
        page.getByText(/Something went wrong/i).first(),
        'the compose screen renders (no error boundary)',
      ).toBeHidden({ timeout: 5_000 });
    }

    test('a file attached in KMail compose uploads to storage and is sent with the mail @ui', async ({
      page,
    }) => {
      const subject = `QA KMail attach ${Date.now()}`;
      await openCompose(page);

      await page.locator('.ql-editor[contenteditable="true"]').first().click();
      await page.keyboard.type('QA KMail attachment — safe to ignore');
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

      // Record the upload-link answer and the real upload request the app makes with it.
      const presign = page.waitForResponse((r) => r.url().includes('/aws/generate-presigned-url'), {
        timeout: 20_000,
      });
      const upload = page
        .waitForRequest((r: Request) => r.method() === 'PUT', { timeout: 20_000 })
        .catch(() => null);
      await page
        .locator('#fileInput')
        .first()
        .setInputFiles({
          name: `qa-kmail-${Date.now()}.jpg`,
          mimeType: 'image/jpeg',
          buffer: JPEG,
        });

      const presigned: Response = await presign;
      const presignBody = await presigned.text().catch(() => '');
      const put = await upload;
      const putResult = put ? await put.response().catch(() => null) : null;
      const observed =
        `upload link: HTTP ${presigned.status()} body=${presignBody.slice(0, 120)}… | ` +
        `upload request: ${put ? `PUT ${put.url().slice(0, 120)}… -> ${putResult?.status() ?? 'no response'}` : 'none made'}`;
      test.info().annotations.push({ type: 'observed', description: observed });
      console.log(`KMAIL-ATTACH ${observed}`);
      const shot = test.info().outputPath('after-attach.png');
      await page.screenshot({ path: shot });
      await test.info().attach('after-attach', { path: shot, contentType: 'image/png' });

      expect(presigned.status(), 'the upload link is issued').toBe(200);
      expect(put, `the app uploads the file (${observed})`).not.toBeNull();
      expect(
        put?.url() ?? '',
        `the file is uploaded to an https storage address, not to the raw response text (${observed})`,
      ).toMatch(/^https:\/\//);
      expect(putResult?.ok(), `the storage upload succeeds (${observed})`).toBe(true);

      const done = page.getByRole('button', { name: /^Done$/i }).first();
      await expect(done, 'Done enables once the upload finishes').toBeEnabled({ timeout: 30_000 });
      await done.click();
      await settleFrames(page);

      const send = page.waitForResponse((r) => r.url().includes('/sentMail/postMail'), {
        timeout: 20_000,
      });
      await page
        .locator('.post_button_size')
        .filter({ has: page.locator('.icon-KP_3164') })
        .first()
        .click()
        .catch(() => page.locator('.post_button_size').first().click());
      const sent = await send;
      const body = (sent.request().postDataJSON() ?? {}) as { attachmentUuid?: unknown[] };
      expect(sent.status(), 'the mail is sent').toBe(200);
      expect(
        body.attachmentUuid?.length ?? 0,
        'the sent mail carries the uploaded attachment',
      ).toBeGreaterThan(0);
    });
  },
);
