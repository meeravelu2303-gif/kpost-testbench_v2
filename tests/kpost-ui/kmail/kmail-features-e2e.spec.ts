import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { STORAGE_STATE_2 } from '@config/constants';
import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import { mailShape } from '@api/definitions/kmail/send.api';
import type { Browser, Dialog, Page } from '@playwright/test';
import { createQaGroup, deleteQaGroup, type QaGroup } from '../support/groups';
import { isKnownAppAlert } from '../support/known-dialogs';
import { signedIn } from '@fixtures/login-gate';

/**
 * KMail features on the real screens: copies (CC/BCC), group mail, save draft, Comment / Clarify /
 * Delete, and received attachments. API cross-checks log in only as qatest3: an API login as a browser
 * account kills its session. Accounts: A = qatest1, B = STORAGE_STATE_2 (qatest2), C = qatest3.
 */
const C: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal-3')!;
const QATEST4 = 'qatest4@kpostindia.com';

test.describe(
  'KPost KMail · features through the screens @ui',
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
    test.skip(
      !testData.kpostId || !testData.victimKpostId || !testData.personal3KpostId,
      'needs the three QA accounts',
    );

    const waitLoaded = (page: Page) =>
      page
        .locator('.loader-overlay')
        .waitFor({ state: 'hidden', timeout: 30_000 })
        .catch(() => undefined);

    async function openCompose(page: Page): Promise<void> {
      await page.goto('/writemail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await waitLoaded(page);
    }

    async function fillTo(page: Page, id: string): Promise<void> {
      const to = page.locator('.subjectTextboxKmailTO, input[name="to"]').first();
      await to.click();
      await to.fill(id);
      await page
        .locator('.suggestion-dropdown')
        .getByText(id, { exact: false })
        .first()
        .click({ timeout: 4_000 })
        .catch(() => undefined);
      // The To suggestion list stays open after a pick and covers the editor, so close it.
      await page.keyboard.press('Escape').catch(() => undefined);
    }

    async function fillSubjectBody(page: Page, subject: string, body: string): Promise<void> {
      const box = page.locator('.toInput').first();
      // Type like a user: in Firefox, fill() leaves this field empty after the copies picker (not an app bug).
      await box.click();
      await page.keyboard.type(subject);
      await expect(box, 'the subject is typed').toHaveValue(subject);
      await page.locator('.ql-editor[contenteditable="true"]').first().click();
      await page.keyboard.type(body);
      await expect(box, 'the subject is still there after typing the mail text').toHaveValue(
        subject,
      );
    }

    /** Press the compose send button and return the postMail request body + status. */
    async function sendAndCapture(page: Page, last = false) {
      const send = page.waitForResponse((r) => r.url().includes('/sentMail/postMail'), {
        timeout: 20_000,
      });
      const button = page
        .locator('.post_button_size')
        .filter({ has: page.locator('.icon-KP_3164') });
      await (last ? button.last() : button.first()).click();
      const res = await send;
      return {
        status: res.status(),
        body: (res.request().postDataJSON() ?? {}) as Record<string, unknown>,
        text: (await res.text().catch(() => '')).slice(0, 200),
      };
    }

    /** True once `who`'s thread with `other` contains `subject` (polled — delivery takes a moment). */
    async function inboxHas(
      endpoints: EndpointExecutor,
      who: Principal,
      other: string,
      subject: string,
      groupFlag = false,
    ): Promise<boolean> {
      let found = false;
      await expect
        .poll(
          async () => {
            const ex = await endpoints.sendTo(
              'kmail-selected-contact-mails',
              {
                body: {
                  selectedContact: other,
                  fetchMailType: 'A',
                  groupFlag,
                  lastKmailID: null,
                  firstKmailID: null,
                  count: 30,
                },
              },
              { label: 'features:inbox', auth: { principal: who }, allowLiveRead: true },
            );
            found = ex.bodyText.includes(subject);
            return found;
          },
          { timeout: 30_000, intervals: [3_000] },
        )
        .toBe(true)
        .catch(() => undefined);
      return found;
    }

    /** As B, open the mail with `subject` and open its reply-arrow menu. */
    async function openAsBWithMenu(browser: Browser, subject: string) {
      const context = await browser.newContext({ storageState: signedIn(STORAGE_STATE_2) });
      const b = await context.newPage();
      await b.goto('/kmail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await waitLoaded(b);
      await b.locator('.Serach_input').first().fill(subject);
      await b.getByText(subject, { exact: false }).first().click({ timeout: 30_000 });
      await expect(b.getByText(`Sub : ${subject}`, { exact: false }).first()).toBeVisible({
        timeout: 20_000,
      });
      await b.getByTestId('ReplyIcon').first().click();
      return { context, b, menu: b.locator('[role="menu"]') };
    }

    async function sendPlain(page: Page, subject: string): Promise<void> {
      await openCompose(page);
      await fillTo(page, testData.victimKpostId);
      await fillSubjectBody(page, subject, `QA body ${subject}`);
      const sent = await sendAndCapture(page);
      expect(sent.status, `A sends the mail: ${sent.text}`).toBe(200);
    }

    test(
      'Add copies: a CC and a Confidential Copy picked in "Mail With Copies" go out as cc/bcc and the CC receives it @ui',
      {
        annotation: [
          { type: 'requirement', description: 'FR-KM-006' },
          { type: 'requirement', description: 'FR-KM-009' },
          { type: 'requirement', description: 'RTM-KMAIL-F06' },
        ],
      },
      async ({ page, endpoints }) => {
        const subject = `QA KMail copies ${Date.now()}`;
        await openCompose(page);
        await fillTo(page, testData.victimKpostId);
        await page.keyboard.press('Escape').catch(() => undefined);
        await page.getByText('Add copies', { exact: false }).first().click();
        const picker = page.getByRole('dialog').filter({ hasText: 'Mail With Copies' });
        await expect(picker, 'the Mail With Copies picker opens').toBeVisible({ timeout: 15_000 });
        const rowFor = (name: string) =>
          picker
            .locator('div')
            .filter({ has: page.getByText(name, { exact: true }) })
            .filter({ has: page.locator('input[type="radio"]') })
            .last();
        await rowFor('Qatest3 Bench').locator('input[type="radio"]').nth(0).check(); // Copy (CC)
        await rowFor('Qatest4 Bench').locator('input[type="radio"]').nth(1).check(); // Confidential (BCC)
        await picker.getByRole('button', { name: /^Done$/i }).click();
        await fillSubjectBody(page, subject, 'QA copies body');
        const sent = await sendAndCapture(page);
        test.info().annotations.push({
          type: 'observed',
          description: `send ${sent.status} ccList=${JSON.stringify(sent.body.ccList)} bccList=${JSON.stringify(sent.body.bccList)}`,
        });
        expect(sent.status, `the mail with copies is sent: ${sent.text}`).toBe(200);
        expect(sent.body.ccList, 'qatest3 goes as a Copy (cc)').toEqual([C.username]);
        expect(sent.body.bccList, 'qatest4 goes as a Confidential Copy (bcc)').toEqual([QATEST4]);
        expect(
          await inboxHas(endpoints, C, testData.kpostId, subject),
          'the CC recipient (qatest3) receives the mail',
        ).toBe(true);
      },
    );

    test('Group Mail: a mail sent to a group from Write Mail reaches the group’s members @ui', async ({
      page,
      endpoints,
    }) => {
      let group: QaGroup | undefined;
      try {
        // Created by personal-3 (never by the browser's account); qatest1 + qatest2 are members.
        group = await createQaGroup(endpoints, 'kmail-group-mail', {
          admins: [testData.kpostId],
          members: [testData.victimKpostId],
        });
        const groupName = await (async () => {
          const ex = await endpoints.sendTo(
            'contacts-my-groups',
            { body: { lastfetchDate: null } },
            { label: 'features:groups', auth: { principal: C }, allowLiveRead: true },
          );
          const m = new RegExp(
            `"groupKpostName":"(QA UI kmail-group-mail [0-9]+)","groupKpostID":"${group.groupKpostID}"`,
          ).exec(ex.bodyText);
          return m?.[1] ?? 'QA UI kmail-group-mail';
        })();
        const subject = `QA KMail group mail ${Date.now()}`;
        await openCompose(page);
        await page.getByText('Group Mail', { exact: true }).first().click();
        const to = page.locator('.subjectTextboxKmailTO, input[name="to"]').first();
        await to.click();
        await to.fill(groupName);
        await page.getByText(groupName, { exact: false }).last().click({ timeout: 15_000 });
        await fillSubjectBody(page, subject, 'QA group mail body');
        const sent = await sendAndCapture(page);
        test.info().annotations.push({
          type: 'observed',
          description: `send ${sent.status} to=${String(sent.body.toAddress)} groupFlag=${String(sent.body.groupFlag)} ${sent.text}`,
        });
        expect(sent.status, `the group mail is sent: ${sent.text}`).toBe(200);
        expect(sent.body.groupFlag, 'it is sent as a group mail').toBe(true);
        // The group thread would need the group id, which the live-safety guard refuses, so check
        // qatest3's KMail dashboard instead.
        let dashboard = '';
        const received = await expect
          .poll(
            async () => {
              const ex = await endpoints.sendTo(
                'kmail-dashboard',
                { body: { kmailID: '' } },
                { label: 'features:group-dashboard', auth: { principal: C }, allowLiveRead: true },
              );
              dashboard = ex.bodyText;
              return ex.bodyText.includes(subject);
            },
            { timeout: 30_000, intervals: [3_000] },
          )
          .toBe(true)
          .then(
            () => true,
            () => false,
          );
        if (!received) {
          console.log(
            `KMAIL-FEATURES qatest3 dashboard (no group mail): ${dashboard.slice(0, 400)}`,
          );
        }
        expect(received, 'a group member (qatest3) receives the group mail').toBe(true);
      } finally {
        await deleteQaGroup(endpoints, group);
      }
    });

    test(
      'Save Draft: a half-written mail is saved and listed under Status of Mails › Draft Mails @ui',
      { annotation: [{ type: 'requirement', description: 'RTM-KMAIL-F08' }] },
      async ({ page }) => {
        const subject = `QA KMail draft ${Date.now()}`;
        await openCompose(page);
        await fillTo(page, testData.victimKpostId);
        await fillSubjectBody(page, subject, 'QA draft body');
        const saved = page.waitForResponse((r) => r.url().includes('/draft/draftMail'), {
          timeout: 20_000,
        });
        await page.locator('.icon-KP_95-Write-Mail-Temp').first().click();
        const res = await saved;
        expect(res.status(), 'the draft is saved').toBe(200);
        await expect(
          page.getByText('Mail Saved to Draft', { exact: false }).first(),
          'the app confirms the draft was saved',
        ).toBeVisible({ timeout: 10_000 });

        await page.goto('/kmail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await waitLoaded(page);
        await page.getByText('Status of Mails', { exact: false }).first().click();
        await page.getByText('Draft Mails', { exact: false }).first().click();
        await expect(
          page.getByText(subject, { exact: false }).first(),
          'the saved draft is listed under Draft Mails',
        ).toBeVisible({ timeout: 20_000 });
      },
    );

    for (const action of [
      { name: 'Comment', type: 8 },
      { name: 'Clarify', type: 9 },
    ] as const) {
      test(`${action.name}: B ${action.name.toLowerCase()}s on A’s mail from the opened mail and it is sent as a ${action.name} @ui`, async ({
        page,
        browser,
      }) => {
        const subject = `QA KMail ${action.name} ${Date.now()}`;
        await sendPlain(page, subject);
        const { context, b, menu } = await openAsBWithMenu(browser, subject);
        try {
          await menu.getByText(action.name, { exact: true }).first().click();
          const editor = b.locator('.ql-editor[contenteditable="true"]').last();
          await expect(editor, `the ${action.name} composer opens`).toBeVisible({
            timeout: 15_000,
          });
          await editor.click();
          await b.keyboard.type(`QA ${action.name} text`);
          const sent = await sendAndCapture(b, true);
          test.info().annotations.push({
            type: 'observed',
            description: `${action.name} send ${sent.status} kmailType=${String(sent.body.kmailType)} referenceKmailID=${JSON.stringify(sent.body.referenceKmailID)} ${sent.text}`,
          });
          expect(sent.status, `the ${action.name} is sent: ${sent.text}`).toBe(200);
          expect(sent.body.kmailType, `it is sent as a ${action.name}`).toBe(action.type);
          expect(
            (sent.body.referenceKmailID as unknown[] | undefined)?.length ?? 0,
            `the ${action.name} points at A’s mail`,
          ).toBeGreaterThan(0);
        } finally {
          await context.close();
        }
      });
    }

    test('Delete: B deletes a received mail from the opened mail and it is marked deleted (greyed out) in B’s KMail @ui', async ({
      page,
      browser,
    }) => {
      const subject = `QA KMail delete ${Date.now()}`;
      await sendPlain(page, subject);
      const { context, b, menu } = await openAsBWithMenu(browser, subject);
      try {
        await menu.getByText('More', { exact: true }).first().click();
        const deleted = b.waitForResponse(
          (r) => /delete/i.test(r.url()) && r.request().method() === 'POST',
          {
            timeout: 20_000,
          },
        );
        // Delete uses window.confirm, which Playwright dismisses unless accepted. Accept only the
        // confirm box: the app's microphone alerts (#1360) can arrive first.
        let confirmText = '';
        const onDialog = (dialog: Dialog) => {
          if (isKnownAppAlert(dialog) || dialog.type() !== 'confirm') {
            void dialog.dismiss();
            return;
          }
          confirmText = dialog.message();
          void dialog.accept();
        };
        b.on('dialog', onDialog);
        await menu.getByText('Delete', { exact: true }).first().click();
        const res = await deleted;
        b.off('dialog', onDialog);
        expect(confirmText, 'the app asks before deleting').toMatch(/delete/i);
        test.info().annotations.push({
          type: 'observed',
          description: `delete ${res.request().method()} ${res.url()} -> ${res.status()}`,
        });
        expect(res.status(), 'the delete is accepted').toBe(200);
        // Reopen B's conversation after a reload; the Recents search filters nothing if typed before
        // the list loads.
        await b.reload({ waitUntil: 'domcontentloaded' });
        await waitLoaded(b);
        await expect(b.getByText('Today', { exact: true }).first()).toBeVisible({
          timeout: 30_000,
        });
        const thread = b.waitForResponse((r) => r.url().includes('/common/selectedContactMails'), {
          timeout: 30_000,
        });
        await b
          .getByText('Qatest1 Bench', { exact: true })
          .filter({ visible: true })
          .first()
          .click();
        // By design a deleted mail stays in the conversation, greyed out and closed.
        const data = (await (await thread).json()) as {
          data?: {
            kmailSubject?: string;
            kmailTransactionList?: { receiver?: string; deleteByReceiver?: string }[];
          }[];
        };
        const mail = (data.data ?? []).find((m) => m.kmailSubject === subject);
        const flag = mail?.kmailTransactionList?.find(
          (t) => t.receiver === testData.victimKpostId,
        )?.deleteByReceiver;
        const greyed = b
          .locator('.deletedMail')
          .filter({ hasText: subject })
          .filter({ visible: true });
        await expect(
          greyed,
          'the deleted mail is shown greyed out in B’s conversation',
        ).toHaveCount(1, { timeout: 20_000 });
        const shot = test.info().outputPath('after-delete.png');
        await b.screenshot({ path: shot });
        await test.info().attach('after-delete', { path: shot, contentType: 'image/png' });
        test.info().annotations.push({
          type: 'observed',
          description: `after delete: listed=${Boolean(mail)} deleteByReceiver=${String(flag)}`,
        });
        expect(flag, 'the server records the mail as deleted by B').toBe('Y');
      } finally {
        await context.close();
      }
    });

    test(
      'Attachment received: the recipient sees the attached file on the opened mail and can download it @ui',
      { annotation: [{ type: 'requirement-partial', description: 'RTM-KMAIL-F02' }] },
      async ({ page, endpoints }) => {
        // qatest3 uploads through the API (known defect #1347: the browser upload is broken) and sends to qatest1.
        const subject = `QA KMail attachment in ${Date.now()}`;
        const jpeg = Buffer.from(
          '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=',
          'base64',
        );
        const fileName = `qa-received-${Date.now()}.jpg`;
        const presign = await endpoints.sendTo(
          'aws-generate-presigned',
          { body: { extension: 'jpg', fileName, fileSize: String(jpeg.length) } },
          { label: 'features:presign', auth: { principal: C }, allowLiveWrite: true },
        );
        const raw = presign.bodyText.trim();
        const url = raw.startsWith('{')
          ? String((JSON.parse(raw) as { presignedURL?: string }).presignedURL ?? '')
          : raw.replace(/^"|"$/g, '');
        const uuid = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(
          url,
        )?.[1];
        expect(uuid, 'the upload link names a file id').toBeTruthy();
        const put = await fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'image/jpeg' },
          body: jpeg,
        });
        expect(put.status, 'the file is stored').toBeLessThan(300);
        const sent = await endpoints.sendTo(
          'kmail-post-mail',
          {
            body: mailShape({
              toAddress: testData.kpostId,
              kmailSubject: subject,
              attachmentFlag: 1,
              attachmentUuid: [uuid],
              attachmentCaption: JSON.stringify([{ fileName, caption: '' }]),
            }),
          },
          { label: 'features:send-attachment', auth: { principal: C }, allowLiveWrite: true },
        );
        expect(sent.status, 'qatest3 sends the mail with the attachment').toBe(200);

        await page.goto('/kmail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await waitLoaded(page);
        await page.locator('.Serach_input').first().fill(subject);
        // What the server returns when the mail is opened — does it list the attachment?
        const opened = page.waitForResponse(
          (r) => r.url().includes('/readMail/sentAndInboxMailContent'),
          { timeout: 30_000 },
        );
        await page.getByText(subject, { exact: false }).first().click({ timeout: 30_000 });
        const content = await opened.catch(() => null);
        const contentText = content ? await content.text().catch(() => '') : '(no open request)';
        const listed = contentText.includes(fileName) || contentText.includes(uuid ?? '__none__');
        test.info().annotations.push({
          type: 'observed',
          description: `open reply lists the attachment: ${listed} | ${contentText.slice(0, 300)}`,
        });
        console.log(
          `KMAIL-FEATURES open reply lists the attachment: ${listed} | ${contentText.slice(0, 700)}`,
        );
        const senderView = await endpoints.sendTo(
          'kmail-selected-contact-mails',
          {
            body: {
              selectedContact: testData.kpostId,
              fetchMailType: 'A',
              groupFlag: false,
              lastKmailID: null,
              firstKmailID: null,
              count: 10,
            },
          },
          { label: 'features:sender-view', auth: { principal: C }, allowLiveRead: true },
        );
        const row = (
          (JSON.parse(senderView.bodyText || '{}') as { data?: Array<Record<string, unknown>> })
            .data ?? []
        ).find((m) => m.kmailSubject === subject);
        console.log(
          `KMAIL-FEATURES sender row: attachmentFlag=${String(row?.attachmentFlag)} attachmentPath=${JSON.stringify(row?.attachmentPath)}`,
        );
        await expect(page.getByText(`Sub : ${subject}`, { exact: false }).first()).toBeVisible({
          timeout: 20_000,
        });
        const shot = test.info().outputPath('received-attachment.png');
        await page.screenshot({ path: shot });
        await test.info().attach('received-attachment', { path: shot, contentType: 'image/png' });
        // Known defect #1348: the opened mail intermittently renders without body or attachments, so
        // reopen up to 3 times; the attempt count is recorded.
        const chip = page.getByText(fileName.slice(0, 12), { exact: false }).first();
        let attempts = 1;
        while (!(await chip.isVisible({ timeout: 10_000 }).catch(() => false)) && attempts < 3) {
          attempts++;
          await page.goto('/kmail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
          await waitLoaded(page);
          await page.locator('.Serach_input').first().fill(subject);
          await page.getByText(subject, { exact: false }).first().click({ timeout: 30_000 });
        }
        test.info().annotations.push({
          type: 'observed',
          description: `attachment check after ${attempts} open(s), shown: ${await chip.isVisible().catch(() => false)} (#1348)`,
        });
        console.log(`KMAIL-FEATURES attachment check after ${attempts} open(s)`);
        await expect(
          chip,
          'the attached file is shown on the opened mail (#1348: body and attachments intermittently missing)',
        ).toBeVisible({
          timeout: 10_000,
        });
        // The attachment box's download icon (POST /readMail/downloadODAttachment).
        const download = page.waitForResponse(
          (r) => r.url().includes('/readMail/downloadODAttachment'),
          { timeout: 20_000 },
        );
        await page.locator('.attachment-download-all').first().click();
        const res = await download.catch(() => null);
        const bytes = res ? (await res.body().catch(() => Buffer.alloc(0))).length : 0;
        test.info().annotations.push({
          type: 'observed',
          description: `download: ${res ? `${res.url()} -> ${res.status()}, ${bytes} bytes` : 'no download request'}`,
        });
        expect(res?.status(), 'the download icon downloads the attachment').toBe(200);
        expect(bytes, 'the downloaded file is not empty').toBeGreaterThan(0);
      },
    );

    test('an opened mail shows its body whatever its format — plain, or written like Write Mail with the signature block (#1348) @ui', async ({
      page,
      endpoints,
    }) => {
      const stamp = Date.now();
      // The exact HTML a mail written in Write Mail carries: greeting, the body in a <div>, then the
      // app's <table id='signature'> block.
      const signature =
        " <table id='signature' cellpadding='0' cellspacing='0' border='0' style='font-size:14px; margin-top:15px;'> <tr> <td style='padding-right:8px;'> <div style='width:50px; height:50px; border-radius:50%; background-color:#ccc; display:table;'> <span style='display:table-cell; text-align:center; vertical-align:middle; font-weight:bold; font-size:18px; color:#333;'>QB</span> </div> </td> <td style='vertical-align:middle;'> <div style='font-weight:bold;'>Thanks &amp; Regards,</div> <div>Qatest3 Bench</div> </td> </tr> </table> ";
      const variants = [
        {
          key: 'plain',
          content: `Hello QA,<br/>QA body plain ${stamp}`,
          text: `QA body plain ${stamp}`,
        },
        {
          key: 'write-mail format with signature',
          content: `Hi qatest1 bench,<br/><div>QA body signed ${stamp}</div>${signature}`,
          text: `QA body signed ${stamp}`,
        },
        {
          key: 'write-mail format without signature',
          content: `Hi qatest1 bench,<br/><div>QA body unsigned ${stamp}</div>`,
          text: `QA body unsigned ${stamp}`,
        },
      ];
      const results: string[] = [];
      for (const v of variants) {
        const subject = `QA KMail body ${v.key} ${stamp}`;
        const sent = await endpoints.sendTo(
          'kmail-post-mail',
          {
            body: mailShape({
              toAddress: testData.kpostId,
              kmailSubject: subject,
              kmailContent: v.content,
            }),
          },
          { label: `features:body-${v.key}`, auth: { principal: C }, allowLiveWrite: true },
        );
        expect(sent.status, `qatest3 sends the ${v.key} mail`).toBe(200);
        await page.goto('/kmail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await waitLoaded(page);
        await page.locator('.Serach_input').first().fill(subject);
        await page.getByText(subject, { exact: false }).first().click({ timeout: 30_000 });
        await expect(page.getByText(`Sub : ${subject}`, { exact: false }).first()).toBeVisible({
          timeout: 20_000,
        });
        const shown = await page
          .getByText(v.text, { exact: false })
          .first()
          .isVisible({ timeout: 15_000 })
          .catch(() => false);
        results.push(`${v.key}: body shown=${shown}`);
        const shot = test.info().outputPath(`body-${v.key.replace(/\s+/g, '-')}.png`);
        await page.screenshot({ path: shot });
        await test.info().attach(`body-${v.key}`, { path: shot, contentType: 'image/png' });
      }
      const verdict = results.join(' | ');
      test.info().annotations.push({ type: 'observed', description: verdict });
      console.log(`KMAIL-FEATURES ${verdict}`);
      expect(verdict, 'every opened mail shows its body (#1348)').not.toContain('shown=false');
    });
  },
);
