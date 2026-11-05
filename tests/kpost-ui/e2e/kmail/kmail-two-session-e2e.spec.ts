import { writeFileSync } from 'node:fs';
import { AUTH_PROFILES } from '@config/auth-profile';
import { STORAGE_STATE_2 } from '@config/constants';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import type { Page } from '@playwright/test';
import { signedIn } from '@fixtures/login-gate';

/**
 * KMail two people in the browser: A sends in the UI, B finds the mail, opens it and reads the exact body;
 * reply and forward too. Needs STORAGE_STATE_2 (auth2.setup.ts, KATCHUP_UI_LIFECYCLE=true).
 */
test.describe(
  'KPost KMail · two-person flow in the browser @ui',
  { tag: ['@ui', '@kmail', '@regression'] },
  () => {
    test.describe.configure({ timeout: 150_000 });
    test.skip(
      process.env.KMAIL_UI_LIFECYCLE !== 'true',
      'sends a real mail; set KMAIL_UI_LIFECYCLE=true',
    );
    test.skip(
      process.env.KATCHUP_UI_LIFECYCLE !== 'true',
      'needs auth2.setup.ts to log the 2nd account in; set KATCHUP_UI_LIFECYCLE=true',
    );
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench') || !testData.victimKpostId,
      'needs both QA accounts',
    );

    async function waitLoaded(page: Page): Promise<void> {
      await page
        .locator('.loader-overlay')
        .waitFor({ state: 'hidden', timeout: 30_000 })
        .catch(() => undefined);
    }

    /** Compose and send a plain mail from `page` to the 2nd account, in the UI. */
    async function sendFromUi(page: Page, subject: string, body: string): Promise<void> {
      await page.goto('/writemail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await waitLoaded(page);
      await page.locator('.ql-editor[contenteditable="true"]').first().click();
      await page.keyboard.type(body);
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
      const send = page.waitForResponse((r) => r.url().includes('/sentMail/postMail'), {
        timeout: 20_000,
      });
      await page
        .locator('.post_button_size')
        .filter({ has: page.locator('.icon-KP_3164') })
        .first()
        .click()
        .catch(() => page.locator('.post_button_size').first().click());
      expect((await send).status(), 'A sends the mail from the compose screen').toBe(200);
    }

    test(
      'a mail A sends in the UI reaches B, and B opens it and reads the exact body @ui',
      {
        annotation: [
          { type: 'requirement', description: 'FR-KM-012' },
          { type: 'requirement', description: 'FR-KM-018' },
          { type: 'requirement', description: 'RTM-KMAIL-F07' },
        ],
      },
      async ({ page, browser }) => {
        const stamp = Date.now();
        const subject = `QA KMail E2E ${stamp}`;
        const body = `QA two-person KMail body ${stamp}`;
        await sendFromUi(page, subject, body);

        const context = await browser.newContext({ storageState: signedIn(STORAGE_STATE_2) });
        const receiver = await context.newPage();
        try {
          await receiver.goto('/kmail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
          await waitLoaded(receiver);
          await receiver.locator('.Serach_input').first().fill(subject);
          const row = receiver.getByText(subject, { exact: false }).first();
          await expect(row, 'B receives the mail in KMail').toBeVisible({ timeout: 30_000 });

          const opened = receiver.waitForResponse(
            (r) => r.url().includes('/readMail/sentAndInboxMailContent'),
            { timeout: 20_000 },
          );
          await row.click();
          const content = await opened.catch(() => null);
          const sentBody = content?.request().postData() ?? '(no open request seen)';
          const reply = content ? await content.text().catch(() => '') : '';
          const observed = `open request: ${sentBody} -> ${content?.status() ?? '-'} ${reply.slice(0, 160)}`;
          test.info().annotations.push({ type: 'observed', description: observed });
          console.log(`KMAIL-E2E ${observed}`);

          const bodyView = receiver.locator('.para_fontkm.ql-editor.parent-container').first();
          await expect(bodyView, 'the opened mail shows its body').toBeVisible({ timeout: 20_000 });
          // Proof + map of the opened mail's controls (for the reply/forward steps).
          const shot = test.info().outputPath('b-opened-mail.png');
          await receiver.screenshot({ path: shot });
          await test.info().attach('b-opened-mail', { path: shot, contentType: 'image/png' });
          await test.info().attach('b-opened-mail-aria', {
            body: await receiver
              .locator('body')
              .ariaSnapshot()
              .catch(() => '(no snapshot)'),
            contentType: 'text/plain',
          });
          // Where (if anywhere) the body text shows on screen — every body box and the whole page.
          const shown = await receiver
            .locator('.para_fontkm')
            .evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim().slice(0, 80)))
            .catch(() => [] as string[]);
          const onPage = await receiver.getByText(body, { exact: false }).count();
          const seen = `body boxes: ${JSON.stringify(shown.slice(0, 6))}; body text found on page ${onPage} time(s)`;
          test.info().annotations.push({ type: 'observed', description: seen });
          console.log(`KMAIL-E2E ${seen}`);
          const firstOpen = await receiver
            .getByText(body, { exact: false })
            .first()
            .isVisible({ timeout: 20_000 })
            .catch(() => false);
          // Second angle: a user who sees an empty mail clicks it again — does the body appear then?
          let afterSecondClick = firstOpen;
          if (!firstOpen) {
            await receiver
              .locator('text=Sub :')
              .filter({ hasText: subject })
              .first()
              .click()
              .catch(() => undefined);
            afterSecondClick = await receiver
              .getByText(body, { exact: false })
              .first()
              .isVisible({ timeout: 15_000 })
              .catch(() => false);
            const shot2 = test.info().outputPath('b-after-second-click.png');
            await receiver.screenshot({ path: shot2 });
            await test
              .info()
              .attach('b-after-second-click', { path: shot2, contentType: 'image/png' });
          }
          const verdict = `body shown on first open: ${firstOpen}; after clicking the mail again: ${afterSecondClick}`;
          test.info().annotations.push({ type: 'observed', description: verdict });
          console.log(`KMAIL-E2E ${verdict}`);
          expect(
            firstOpen,
            `B reads exactly what A wrote as soon as the mail is opened — the server returned it (#1348; ${seen}; ${verdict})`,
          ).toBe(true);
        } finally {
          await context.close();
        }
      },
    );

    test(
      'B replies from the opened mail and A receives the reply @ui',
      { annotation: [{ type: 'requirement', description: 'RTM-KMAIL-F01' }] },
      async ({ page, browser }) => {
        const stamp = Date.now();
        const subject = `QA KMail reply ${stamp}`;
        const replyText = `QA reply from B ${stamp}`;
        await sendFromUi(page, subject, `QA mail to reply to ${stamp}`);

        const context = await browser.newContext({ storageState: signedIn(STORAGE_STATE_2) });
        const receiver = await context.newPage();
        try {
          await receiver.goto('/kmail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
          await waitLoaded(receiver);
          await receiver.locator('.Serach_input').first().fill(subject);
          const row = receiver.getByText(subject, { exact: false }).first();
          await expect(row, 'B receives the mail in KMail').toBeVisible({ timeout: 30_000 });
          await row.click();
          await expect(
            receiver.getByText(`Sub : ${subject}`, { exact: false }).first(),
            'the mail opens',
          ).toBeVisible({ timeout: 20_000 });

          // The opened (newest) mail's reply arrow → its menu → "Reply".
          await receiver.getByTestId('ReplyIcon').first().click();
          // The menu item's accessible name includes its icon, so match the visible label exactly.
          await receiver
            .locator('[role="menu"]')
            .getByText('Reply', { exact: true })
            .first()
            .click();
          const editor = receiver.locator('.ql-editor[contenteditable="true"]').last();
          await expect(editor, 'the reply composer opens').toBeVisible({ timeout: 15_000 });
          await editor.click();
          await receiver.keyboard.type(replyText);

          const send = receiver.waitForResponse((r) => r.url().includes('/sentMail/postMail'), {
            timeout: 20_000,
          });
          await receiver
            .locator('.post_button_size')
            .filter({ has: receiver.locator('.icon-KP_3164') })
            .last()
            .click()
            .catch(() => receiver.locator('.post_button_size').last().click());
          const sent = await send;
          const req = (sent.request().postDataJSON() ?? {}) as {
            kmailType?: number;
            referenceKmailID?: unknown[];
            originalKmailID?: number;
            toAddress?: string;
          };
          const observed = `reply send: HTTP ${sent.status()} kmailType=${req.kmailType} to=${req.toAddress} referenceKmailID=${JSON.stringify(req.referenceKmailID)} originalKmailID=${req.originalKmailID}`;
          test.info().annotations.push({ type: 'observed', description: observed });
          console.log(`KMAIL-E2E ${observed}`);
          expect(sent.status(), `B's reply is sent (${observed})`).toBe(200);
          expect(req.toAddress, 'the reply goes back to A').toBe(testData.kpostId);
          expect(
            req.referenceKmailID?.length ?? 0,
            'the reply points at the original mail',
          ).toBeGreaterThan(0);
        } finally {
          await context.close();
        }

        // A's side: the reply arrives in A's KMail thread with B (same subject, shown as a reply).
        await page.goto('/kmail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await waitLoaded(page);
        await page.locator('.Serach_input').first().fill(subject);
        await page.getByText(subject, { exact: false }).first().click({ timeout: 30_000 });
        await expect(
          page.getByText(/Reply/i).first(),
          'A sees B’s reply in the thread',
        ).toBeVisible({
          timeout: 20_000,
        });
        const shot = test.info().outputPath('a-sees-reply.png');
        await page.screenshot({ path: shot });
        await test.info().attach('a-sees-reply', { path: shot, contentType: 'image/png' });
      },
    );

    test(
      'B forwards the mail to a third person from the browser, and they receive it @ui',
      { annotation: [{ type: 'requirement', description: 'RTM-KMAIL-F01' }] },
      async ({ page, browser, endpoints }) => {
        const stamp = Date.now();
        const subject = `QA KMail forward ${stamp}`;
        await sendFromUi(page, subject, `QA mail to forward ${stamp}`);
        const third = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal-3')!;

        const context = await browser.newContext({ storageState: signedIn(STORAGE_STATE_2) });
        const receiver = await context.newPage();
        try {
          await receiver.goto('/kmail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
          await waitLoaded(receiver);
          await receiver.locator('.Serach_input').first().fill(subject);
          const row = receiver.getByText(subject, { exact: false }).first();
          await expect(row, 'B receives the mail in KMail').toBeVisible({ timeout: 30_000 });
          await row.click();
          await expect(
            receiver.getByText(`Sub : ${subject}`, { exact: false }).first(),
            'the mail opens',
          ).toBeVisible({ timeout: 20_000 });

          // Reply arrow → More → Forward.
          await receiver.getByTestId('ReplyIcon').first().click();
          const menu = receiver.locator('[role="menu"]');
          await menu.getByText('More', { exact: true }).first().click();
          await menu.getByText('Forward', { exact: true }).first().click();

          // The forward footer's "Forward To" opens the recipient picker.
          await receiver
            .getByText('Forward To', { exact: true })
            .first()
            .click({ timeout: 15_000 });
          const picker = receiver.getByRole('dialog').last();
          await picker.getByRole('searchbox').first().fill('Qatest3');
          await expect(
            picker.getByText('Qatest3', { exact: false }).first(),
            'the picker finds qatest3',
          ).toBeVisible({ timeout: 10_000 });
          await picker.getByRole('checkbox').last().check();
          await picker.getByRole('button', { name: /^Done$/i }).click();
          // A forward without attachments needs a note ("Mail Content cannot be empty").
          const note = receiver.locator('.ql-editor[contenteditable="true"]').last();
          await note.click();
          await receiver.keyboard.type(`QA forward note ${stamp}`);

          const send = receiver.waitForResponse((r) => r.url().includes('/sentMail/postMail'), {
            timeout: 20_000,
          });
          await receiver
            .locator('.post_button_size')
            .filter({ has: receiver.locator('.icon-KP_3164') })
            .last()
            .click()
            .catch(() => receiver.locator('.post_button_size').last().click());
          const sent = await send;
          const req = (sent.request().postDataJSON() ?? {}) as {
            kmailType?: number;
            forwardList?: string[];
            originalKmailID?: number;
          };
          const replyBody = (await sent.text().catch(() => '')).slice(0, 300);
          const sentRaw = (sent.request().postData() ?? '').slice(0, 900);
          // The full body the app sent, kept as evidence (a file, so it survives the run).
          const bodyFile = test.info().outputPath('forward-request-body.json');
          writeFileSync(bodyFile, sent.request().postData() ?? '');
          await test.info().attach('forward-request-body', {
            path: bodyFile,
            contentType: 'application/json',
          });
          const observed = `forward send: HTTP ${sent.status()} kmailType=${req.kmailType} forwardList=${JSON.stringify(req.forwardList)} originalKmailID=${req.originalKmailID} | reply: ${replyBody} | sent: ${sentRaw}`;
          test.info().annotations.push({ type: 'observed', description: observed });
          console.log(`KMAIL-E2E ${observed}`);
          expect(sent.status(), `B's forward is accepted by the server — #1351 (${observed})`).toBe(
            200,
          );
          expect(req.forwardList ?? [], 'the forward goes to qatest3').toContain(third.username);
          expect(req.originalKmailID, 'the forward points at the original mail').toBeTruthy();
        } finally {
          await context.close();
        }

        // qatest3 (not signed in to any browser here) receives it — checked through its own inbox.
        await expect
          .poll(
            async () => {
              const ex = await endpoints.sendTo(
                'kmail-selected-contact-mails',
                {
                  body: {
                    selectedContact: testData.victimKpostId,
                    fetchMailType: 'A',
                    groupFlag: false,
                    lastKmailID: null,
                    firstKmailID: null,
                    count: 20,
                  },
                },
                { label: 'forward:third-inbox', auth: { principal: third }, allowLiveRead: true },
              );
              return ex.bodyText.includes(subject);
            },
            { message: 'qatest3 receives the forwarded mail', timeout: 30_000, intervals: [3_000] },
          )
          .toBe(true);
      },
    );
  },
);
