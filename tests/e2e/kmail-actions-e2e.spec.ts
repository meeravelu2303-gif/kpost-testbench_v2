import { STORAGE_STATE_2 } from '@config/constants';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import type { Browser, BrowserContext, Page } from '@playwright/test';

/**
 * KMail mail actions through the screens — the menu options not covered elsewhere (live-explored
 * 2026-10-15):
 *   - recipient (reply-arrow menu): Instant Reply (four preset replies + send), Transfer › Katchup
 *     (Transfer.js → "Forward To" picker → POST /katchup/forwardKatchupMessageNew/), Copy (writes the
 *     mail text to the clipboard + "Mail copied to clipboard"), Print ("Print Perview" letter);
 *   - sender (bell menu on their own sent mail): Edit (kmailType 5), Note (6), Reminder (3) — each
 *     opens a composer ("… Mail", "Write your Note" …) and sends through postMail.
 * Forward With Reference is not offered on a received mail's menu (hidden, not broken).
 *
 * Copy, Print and Transfer all take the text from the mail row's `mailContent`
 * (KmailMessage.js wriemailboxOpen), which the row does not carry — the same gap behind #1348/#1351 —
 * so these tests assert the text actually arrives.
 * Accounts: A = default page (qatest1, sender), B = STORAGE_STATE_2 (qatest2, recipient).
 */
test.describe(
  'KPost KMail · mail actions through the screens @ui',
  { tag: ['@ui', '@kmail', '@regression'] },
  () => {
    test.describe.configure({ timeout: 180_000 });
    test.skip(
      process.env.KMAIL_UI_LIFECYCLE !== 'true',
      'sends real mails; set KMAIL_UI_LIFECYCLE=true',
    );
    test.skip(
      process.env.KATCHUP_UI_LIFECYCLE !== 'true',
      'needs auth2.setup.ts for the 2nd account; set KATCHUP_UI_LIFECYCLE=true',
    );
    test.skip(!testData.kpostId || !testData.victimKpostId, 'needs both QA accounts');

    const waitLoaded = (page: Page) =>
      page
        .locator('.loader-overlay')
        .waitFor({ state: 'hidden', timeout: 30_000 })
        .catch(() => undefined);

    /** A sends a plain mail to B from Write Mail; returns the body text it carried. */
    async function sendPlain(page: Page, subject: string): Promise<string> {
      const body = `QA action body ${subject}`;
      await page.goto('/writemail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await waitLoaded(page);
      // Late in a run /writemail sometimes restores the last opened conversation instead of the
      // compose form (seen 2026-10-15) — reload once if the form is not there.
      if (
        !(await page
          .locator('.toInput')
          .first()
          .isVisible({ timeout: 8_000 })
          .catch(() => false))
      ) {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await waitLoaded(page);
      }
      const to = page.locator('.subjectTextboxKmailTO, input[name="to"]').first();
      await to.click();
      await to.fill(testData.victimKpostId);
      await page
        .locator('.suggestion-dropdown')
        .getByText(testData.victimKpostId, { exact: false })
        .first()
        .click({ timeout: 4_000 })
        .catch(() => undefined);
      await page.keyboard.press('Escape').catch(() => undefined);
      await page.locator('.toInput').first().fill(subject);
      await page.locator('.ql-editor[contenteditable="true"]').first().click();
      await page.keyboard.type(body);
      const send = page.waitForResponse((r) => r.url().includes('/sentMail/postMail'), {
        timeout: 20_000,
      });
      await page
        .locator('.post_button_size')
        .filter({ has: page.locator('.icon-KP_3164') })
        .first()
        .click();
      expect((await send).status(), 'A sends the seed mail').toBe(200);
      return body;
    }

    async function openMail(p: Page, subject: string): Promise<void> {
      await p.goto('/kmail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await waitLoaded(p);
      await p.locator('.Serach_input').first().fill(subject);
      await p.getByText(subject, { exact: false }).first().click({ timeout: 30_000 });
      await expect(p.getByText(`Sub : ${subject}`, { exact: false }).first()).toBeVisible({
        timeout: 20_000,
      });
    }

    /** As B (with clipboard access), open the mail and choose `option` from its reply-arrow menu. */
    async function asB(
      browser: Browser,
      subject: string,
      option: string,
    ): Promise<{ ctx: BrowserContext; b: Page }> {
      // Playwright can grant clipboard access only in Chromium (Firefox/WebKit reject the permission).
      const chromium = browser.browserType().name() === 'chromium';
      const ctx = await browser.newContext({
        storageState: STORAGE_STATE_2,
        ...(chromium ? { permissions: ['clipboard-read', 'clipboard-write'] } : {}),
      });
      const b = await ctx.newPage();
      await openMail(b, subject);
      await b.getByTestId('ReplyIcon').first().click();
      const menu = b.locator('[role="menu"]');
      if (
        !(await menu
          .getByText(option, { exact: true })
          .first()
          .isVisible()
          .catch(() => false))
      ) {
        await menu.getByText('More', { exact: true }).first().click();
      }
      await menu.getByText(option, { exact: true }).first().click();
      return { ctx, b };
    }

    test('Instant Reply: B picks a preset reply and it is sent back to A as a reply with that text @ui', async ({
      page,
      browser,
    }) => {
      const subject = `QA KMail instant ${Date.now()}`;
      await sendPlain(page, subject);
      const { ctx, b } = await asB(browser, subject, 'Instant Reply');
      try {
        const preset = 'Thank You for Email.';
        await b.getByText(preset, { exact: true }).first().click({ timeout: 15_000 });
        const send = b.waitForResponse((r) => r.url().includes('/sentMail/postMail'), {
          timeout: 20_000,
        });
        await b
          .locator('.post_button_size')
          .filter({ has: b.locator('.icon-KP_3164') })
          .last()
          .click();
        const res = await send;
        const req = (res.request().postDataJSON() ?? {}) as Record<string, unknown>;
        test.info().annotations.push({
          type: 'observed',
          description: `instant reply: HTTP ${res.status()} kmailType=${String(req.kmailType)} to=${String(req.toAddress)} content=${String(req.kmailContent).slice(0, 80)}`,
        });
        expect(res.status(), 'the instant reply is sent').toBe(200);
        expect(req.kmailType, 'it is sent as a reply').toBe(1);
        expect(req.toAddress, 'it goes back to A').toBe(testData.kpostId);
        expect(String(req.kmailContent), 'it carries the chosen preset text').toContain(preset);
      } finally {
        await ctx.close();
      }
    });

    test('Copy: "Mail copied to clipboard" puts the mail’s text on the clipboard @ui', async ({
      page,
      browser,
      browserName,
    }) => {
      test.skip(
        browserName !== 'chromium',
        'reading the clipboard needs a permission Playwright grants only in Chromium',
      );
      const subject = `QA KMail copy ${Date.now()}`;
      const body = await sendPlain(page, subject);
      const { ctx, b } = await asB(browser, subject, 'Copy');
      try {
        await expect(
          b.getByText('Mail copied to clipboard', { exact: false }).first(),
          'the app confirms the copy',
        ).toBeVisible({ timeout: 10_000 });
        const clip = await b.evaluate(() => navigator.clipboard.readText()).catch(() => '');
        const shot = test.info().outputPath('copy-toast.png');
        await b.screenshot({ path: shot });
        await test.info().attach('copy-toast', { path: shot, contentType: 'image/png' });
        test.info().annotations.push({
          type: 'observed',
          description: `clipboard after "Mail copied to clipboard": ${JSON.stringify(clip).slice(0, 160)}`,
        });
        expect(clip, 'the clipboard holds the mail’s text (#1353)').toContain(body);
      } finally {
        await ctx.close();
      }
    });

    test('Print: the print preview shows the mail’s text @ui', async ({ page, browser }) => {
      const subject = `QA KMail print ${Date.now()}`;
      const body = await sendPlain(page, subject);
      const { ctx, b } = await asB(browser, subject, 'Print');
      try {
        const preview = b.getByText('Kmail Letter', { exact: false }).first();
        await expect(preview, 'the print preview opens').toBeVisible({ timeout: 15_000 });
        await expect(
          b.getByText(subject, { exact: false }).last(),
          'the preview shows the subject',
        ).toBeVisible();
        const shot = test.info().outputPath('print-preview.png');
        await b.screenshot({ path: shot });
        await test.info().attach('print-preview', { path: shot, contentType: 'image/png' });
        await expect(
          b.getByText(body, { exact: false }).first(),
          'the preview shows the mail’s text (the letter body must not be empty — #1354)',
        ).toBeVisible({ timeout: 10_000 });
      } finally {
        await ctx.close();
      }
    });

    test('Transfer › Katchup: B transfers the mail to a Katchup contact and the mail’s text goes with it @ui', async ({
      page,
      browser,
    }) => {
      const subject = `QA KMail transfer ${Date.now()}`;
      const body = await sendPlain(page, subject);
      const { ctx, b } = await asB(browser, subject, 'Transfer');
      try {
        await b.getByText('Katchup', { exact: true }).first().click({ timeout: 15_000 });
        const picker = b.getByRole('dialog').filter({ hasText: 'Forward To' });
        await expect(picker, 'the Forward To picker opens').toBeVisible({ timeout: 15_000 });
        await picker.getByRole('searchbox').first().fill('Qatest3');
        await expect(picker.getByText('Qatest3', { exact: false }).first()).toBeVisible({
          timeout: 10_000,
        });
        await picker.getByRole('checkbox').last().check();
        const sent = b.waitForResponse(
          (r) => r.url().includes('/katchup/forwardKatchupMessageNew'),
          {
            timeout: 20_000,
          },
        );
        const done = picker.getByRole('button', { name: /^Done$/i });
        if (await done.isVisible().catch(() => false)) await done.click();
        else await b.locator('.post_button_size').last().click();
        const res = await sent;
        const req = (res.request().postDataJSON() ?? {}) as Record<string, unknown>;
        const text = (await res.text().catch(() => '')).slice(0, 160);
        test.info().annotations.push({
          type: 'observed',
          description: `transfer: HTTP ${res.status()} subject=${String(req.subject)} actualMessage=${JSON.stringify(req.actualMessage).slice(0, 120)} | ${text}`,
        });
        expect(res.status(), `the transfer is accepted: ${text}`).toBe(200);
        expect(
          String(req.actualMessage),
          'the transferred message carries the mail’s text (#1355)',
        ).toContain(body);
      } finally {
        await ctx.close();
      }
    });

    for (const action of [
      { name: 'Edit', type: 5 },
      { name: 'Note', type: 6 },
      { name: 'Reminder', type: 3 },
    ] as const) {
      test(`${action.name}: A adds a ${action.name.toLowerCase()} to their own sent mail and it is sent as a ${action.name} @ui`, async ({
        page,
      }) => {
        const subject = `QA KMail ${action.name} ${Date.now()}`;
        await sendPlain(page, subject);
        await openMail(page, subject);
        await page.getByTestId('NotificationsNoneIcon').first().click();
        await page.locator('[role="menu"]').getByText(action.name, { exact: true }).first().click();
        const editor = page.locator('.ql-editor[contenteditable="true"]').last();
        await expect(editor, `the ${action.name} composer opens`).toBeVisible({ timeout: 15_000 });
        await editor.click();
        await page.keyboard.type(`QA ${action.name} text`);
        const send = page.waitForResponse((r) => r.url().includes('/sentMail/postMail'), {
          timeout: 20_000,
        });
        await page
          .locator('.post_button_size')
          .filter({ has: page.locator('.icon-KP_3164') })
          .last()
          .click();
        const res = await send;
        const req = (res.request().postDataJSON() ?? {}) as Record<string, unknown>;
        const text = (await res.text().catch(() => '')).slice(0, 160);
        test.info().annotations.push({
          type: 'observed',
          description: `${action.name}: HTTP ${res.status()} kmailType=${String(req.kmailType)} referenceKmailID=${JSON.stringify(req.referenceKmailID)} | ${text}`,
        });
        expect(res.status(), `the ${action.name} is sent: ${text}`).toBe(200);
        expect(req.kmailType, `it is sent as a ${action.name}`).toBe(action.type);
      });
    }
  },
);
