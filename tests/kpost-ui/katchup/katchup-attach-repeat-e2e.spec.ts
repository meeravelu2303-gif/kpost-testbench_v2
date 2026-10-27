import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import type { Page } from '@playwright/test';
import { EDITOR, messageBySubject, openComposer } from '../support/katchup';

/**
 * Katchup attachments sent back to back without a page reload; each step is asserted so a stuck send
 * names where it stuck. ATTACH_REPEAT (default 3) sets the consecutive-send count.
 */
const REPEAT = Math.max(2, Number(process.env.ATTACH_REPEAT ?? 3));

/** A tiny real 1x1 JPEG. */
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=',
  'base64',
);

test.describe(
  'KPost Katchup · attachments sent back-to-back without a reload @ui',
  { tag: ['@ui', '@katchup', '@regression'] },
  () => {
    test.describe.configure({ timeout: 240_000 });
    test.skip(
      process.env.KATCHUP_UI_LIFECYCLE !== 'true',
      'drives real uploads + sends; set KATCHUP_UI_LIFECYCLE=true',
    );
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench') || !testData.victimKpostId,
      'needs both QA accounts',
    );

    /**
     * Attach `fileName` and send it with `subject` in the already-open thread, step by step. Fails
     * with the step that got stuck. Never reloads the page.
     */
    async function attachAndSend(page: Page, subject: string, fileName: string): Promise<void> {
      const step = (s: string) => `[${subject} · ${fileName}] ${s}`;
      const subjectBox = page.getByRole('textbox', { name: 'Subject' });
      if (!(await subjectBox.isVisible().catch(() => false))) {
        await page.locator('.msg-arrow').first().click();
      }
      await subjectBox.fill(subject);
      await page.locator(EDITOR).first().click();
      await page.keyboard.type(`QA back-to-back attachment ${fileName}`);

      const presign = page.waitForResponse((r) => r.url().includes('/generate-presigned-url'), {
        timeout: 20_000,
      });
      const upload = page.waitForResponse(
        (r) => r.request().method() === 'PUT' && /amazonaws|s3/i.test(r.url()),
        { timeout: 30_000 },
      );
      await page
        .locator('#fileInput')
        .setInputFiles({ name: fileName, mimeType: 'image/jpeg', buffer: JPEG });

      const presigned = await presign.catch(() => null);
      expect(presigned?.status(), step('the presigned-upload URL is issued')).toBe(200);
      const stored = await upload.catch(() => null);
      expect(stored?.ok(), step('the file uploads to storage')).toBe(true);

      const done = page.getByRole('button', { name: /^Done$/i });
      await expect(done, step('the attachment modal opens')).toBeVisible({ timeout: 15_000 });
      await expect(done, step('Done enables once the upload finishes')).toBeEnabled({
        timeout: 30_000,
      });
      await done.click();

      const sendCall = page.waitForResponse((r) => r.url().includes('/katchup/sendMessage'), {
        timeout: 20_000,
      });
      await page.locator(EDITOR).first().click();
      await page.keyboard.press('Enter');
      const sent = await sendCall.catch(() => null);
      expect(sent?.status(), step('the message is sent (sendMessage answers)')).toBe(200);
      const body = (sent?.request().postDataJSON() ?? {}) as { uuid?: unknown };
      expect(
        Array.isArray(body.uuid) ? body.uuid.length : 0,
        step('the send carries the attachment'),
      ).toBeGreaterThan(0);

      const message = messageBySubject(page, subject);
      await expect(message, step('the sent message appears in the thread')).toBeVisible({
        timeout: 20_000,
      });
      await expect(
        message.locator('img').first(),
        step('the sent message shows its attachment'),
      ).toBeVisible({ timeout: 15_000 });
    }

    /** Best-effort, time-boxed delete of the sent messages (never hangs on a missing one). */
    async function cleanUp(page: Page, subjects: string[]): Promise<void> {
      for (const subject of subjects) {
        const message = messageBySubject(page, subject);
        if (!(await message.isVisible({ timeout: 3_000 }).catch(() => false))) continue;
        await message.hover({ timeout: 5_000 }).catch(() => undefined);
        const bell = message.getByTestId('NotificationsNoneIcon').first();

        if (
          !(await bell.click({ force: true, timeout: 5_000 }).then(
            () => true,
            () => false,
          ))
        )
          continue;
        await page
          .getByRole('menuitem', { name: /Delete/i })
          .click({ timeout: 5_000 })
          .catch(() => undefined);
        await page
          .getByRole('button', { name: /^Confirm$/i })
          .click({ timeout: 5_000 })
          .catch(() => undefined);
      }
    }

    test('a second attachment sends right after the first, with no page reload @ui', async ({
      page,
    }) => {
      const stamp = Date.now();
      const subjects = [`QA attach 1st ${stamp}`, `QA attach 2nd ${stamp}`];
      await openComposer(page);
      try {
        await attachAndSend(page, subjects[0]!, `qa-first-${stamp}.jpg`);
        await attachAndSend(page, subjects[1]!, `qa-second-${stamp}.jpg`);
      } finally {
        await cleanUp(page, subjects);
      }
    });

    test('after a send the file picker is cleared, so the SAME file can be picked and sent again @ui', async ({
      page,
    }) => {
      const stamp = Date.now();
      const file = `qa-same-${stamp}.jpg`;
      const subjects = [`QA same-file 1st ${stamp}`, `QA same-file 2nd ${stamp}`];
      await openComposer(page);
      try {
        await attachAndSend(page, subjects[0]!, file);

        // Playwright's setInputFiles always fires change, so check the input directly: in a real
        // browser an uncleared input fires no change event for the same file and nothing attaches.
        const left = await page
          .locator('#fileInput')
          .evaluate((el: HTMLInputElement) => ({ value: el.value, files: el.files?.length ?? 0 }));
        test.info().annotations.push({
          type: 'observed',
          description: `file input after the send: value="${left.value}", files=${left.files}`,
        });
        console.log(
          `ATTACH-RESEND file input after the send: value="${left.value}", files=${left.files}`,
        );
        // Screenshot of the composer state right after the first send, as evidence.
        const shot = test.info().outputPath('after-first-send.png');
        await page.screenshot({ path: shot });
        await test.info().attach('after-first-send', { path: shot, contentType: 'image/png' });
        expect(
          left,
          'the file input is reset after a send (#1344) — if it still holds the last file, picking that same file again does nothing in a real browser',
        ).toEqual({ value: '', files: 0 });

        await attachAndSend(page, subjects[1]!, file);
      } finally {
        await cleanUp(page, subjects);
      }
    });

    test(`attachments keep sending across ${REPEAT} consecutive sends with no reload @ui`, async ({
      page,
    }) => {
      const stamp = Date.now();
      const subjects = Array.from({ length: REPEAT }, (_, i) => `QA attach run ${i + 1} ${stamp}`);
      await openComposer(page);
      try {
        for (const [i, subject] of subjects.entries()) {
          await attachAndSend(page, subject, `qa-run-${i + 1}-${stamp}.jpg`);
        }
      } finally {
        await cleanUp(page, subjects);
      }
    });
  },
);
