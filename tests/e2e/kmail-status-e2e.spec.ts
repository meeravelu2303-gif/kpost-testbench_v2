import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { STORAGE_STATE_2 } from '@config/constants';
import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import { mailShape } from '@api/definitions/kmail/send.api';
import type { Page } from '@playwright/test';

/**
 * KMail through the screens — Status of Mails, starring, priority and voice search (live-explored
 * 2026-10-15; source components/Kmail):
 *   - Status of Mails tab: totals from GET /common/statusOfKmailsContactsTotalCount/, each list from
 *     POST /common/statusOfKmailsContactsWithCount/ {kmailStatusFlag: 0 Sent Mail Not Opened,
 *     1 Reply Not Received, 2 Reply Not Sent} → rows of {receiver|sender, count}; a contact row opens
 *     that contact's mails (ContactMailStatus).
 *   - Star: `.icon-KP_43-Fav` on a mail → POST /common/setKmailAsImportant/ → "Mail marked as
 *     important" / "unimportant"; a starred mail's star is coloured (#eba708).
 *   - Priority: Write Mail chip (`.priorityIconInside`, default Low) → Low 0 / Normal 1 / High 2 in
 *     postMail; the mail shows `icon-KP_76-Pri-Low` / `icon-KP_77-pri-medium` / `icon-KP_78-Pri-High`.
 *   - Voice search: the search bar's mic (common/MicInput → browser SpeechRecognition) puts the heard
 *     text in the search box. Headless browsers have no speech engine, so a stand-in recogniser
 *     "hears" a fixed phrase — this checks KMail's wiring, not the browser's speech engine.
 * Accounts: A = default page (qatest1), B = STORAGE_STATE_2 (qatest2); seed mails for the
 * one-account tests come from qatest3 through the API (never logging a browser account in via API).
 */
const C: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal-3')!;
type Flag = 0 | 1 | 2;
const LABEL: Record<Flag, string> = {
  0: 'Sent Mail Not Opened',
  1: 'Reply Not Received',
  2: 'Reply Not Sent',
};

test.describe(
  'KPost KMail · status of mails, star, priority and voice search @ui',
  { tag: ['@ui', '@kmail', '@regression'] },
  () => {
    test.describe.configure({ timeout: 240_000 });
    test.skip(
      process.env.KMAIL_UI_LIFECYCLE !== 'true',
      'sends real mails; set KMAIL_UI_LIFECYCLE=true',
    );
    test.skip(!testData.kpostId || !testData.personal3KpostId, 'needs qatest1 and qatest3');

    const waitLoaded = (page: Page) =>
      page
        .locator('.loader-overlay')
        .waitFor({ state: 'hidden', timeout: 30_000 })
        .catch(() => undefined);

    async function openKmail(page: Page): Promise<void> {
      await page.goto('/kmail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await waitLoaded(page);
    }

    async function seed(endpoints: EndpointExecutor, subject: string): Promise<void> {
      const sent = await endpoints.sendTo(
        'kmail-post-mail',
        { body: mailShape({ toAddress: testData.kpostId, kmailSubject: subject }) },
        { label: 'status:seed', auth: { principal: C }, allowLiveWrite: true },
      );
      expect(sent.status, 'qatest3 sends qatest1 a mail').toBe(200);
    }

    async function openMail(p: Page, subject: string): Promise<void> {
      await openKmail(p);
      await p.locator('.Serach_input').first().fill(subject);
      await p.getByText(subject, { exact: false }).first().click({ timeout: 30_000 });
      await expect(p.getByText(`Sub : ${subject}`, { exact: false }).first()).toBeVisible({
        timeout: 20_000,
      });
    }

    /** Write Mail → `to`, with an optional priority; returns the postMail request body. */
    async function sendFromUi(
      page: Page,
      to: string,
      subject: string,
      priority?: 'Low' | 'Normal' | 'High',
    ): Promise<Record<string, unknown>> {
      await page.goto('/writemail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await waitLoaded(page);
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
      const box = page.locator('.subjectTextboxKmailTO, input[name="to"]').first();
      await box.click();
      await box.fill(to);
      await page
        .locator('.suggestion-dropdown')
        .getByText(to, { exact: false })
        .first()
        .click({ timeout: 4_000 })
        .catch(() => undefined);
      await page.keyboard.press('Escape').catch(() => undefined);
      await page.locator('.toInput').first().fill(subject);
      if (priority) {
        await page.locator('.priorityIconInside').first().click();
        await page.getByText(priority, { exact: true }).filter({ visible: true }).last().click();
        await expect(
          page.locator('.priorityIconInside').first().locator('xpath=..'),
          `the priority chip now reads ${priority}`,
        ).toContainText(priority);
      }
      await page.locator('.ql-editor[contenteditable="true"]').first().click();
      await page.keyboard.type(`QA status body ${subject}`);
      const send = page.waitForResponse((r) => r.url().includes('/sentMail/postMail'), {
        timeout: 20_000,
      });
      await page
        .locator('.post_button_size')
        .filter({ has: page.locator('.icon-KP_3164') })
        .first()
        .click();
      const res = await send;
      expect(res.status(), 'the mail is sent').toBe(200);
      return (res.request().postDataJSON() ?? {}) as Record<string, unknown>;
    }

    /**
     * Open Status of Mails › `flag` on a fresh KMail page and return what the screen shows: the total
     * in the side list ("Reply Not Sent • 31") and the per-contact count the list is rendered from.
     */
    async function status(
      p: Page,
      flag: Flag,
      contact: string,
    ): Promise<{ total: number; forContact: number; raw: string }> {
      await openKmail(p);
      await p.getByText('Status of Mails', { exact: true }).first().click();
      const row = p.getByText(LABEL[flag], { exact: false }).filter({ visible: true }).first();
      await expect(row).toContainText(/•\s*\d+/, { timeout: 20_000 });
      const total = Number((await row.innerText()).replace(/.*•\s*/, '').trim());
      const list = p.waitForResponse((r) => r.url().includes('statusOfKmailsContactsWithCount'), {
        timeout: 20_000,
      });
      await row.click();
      const raw = await (await list).text();
      const body = JSON.parse(raw) as { data?: unknown };
      // An empty list does not come back as [] (seen after Clear All) — treat anything else as empty.
      const rows = Array.isArray(body.data)
        ? (body.data as { receiver?: string; sender?: string; count: number }[])
        : [];
      const hit = rows.find((x) => (x.receiver ?? x.sender) === contact);
      return { total, forContact: hit?.count ?? 0, raw: raw.slice(0, 300) };
    }

    test('Status of Mails: a sent mail is listed as not opened / no reply, and drops off once opened and replied to @ui', async ({
      page,
      browser,
    }) => {
      test.skip(
        process.env.KATCHUP_UI_LIFECYCLE !== 'true',
        'needs auth2.setup.ts for the 2nd account; set KATCHUP_UI_LIFECYCLE=true',
      );
      const A = testData.kpostId;
      const B = testData.victimKpostId;
      const ctx = await browser.newContext({ storageState: STORAGE_STATE_2 });
      const b = await ctx.newPage();
      const steps: string[] = [];
      try {
        const notOpened0 = await status(page, 0, B);
        const bNotSent0 = await status(b, 2, A);

        const subject = `QA KMail status ${Date.now()}`;
        await sendFromUi(page, B, subject);

        const notOpened1 = await status(page, 0, B);
        steps.push(`A not-opened for B: ${notOpened0.forContact} → ${notOpened1.forContact}`);
        expect(notOpened1.forContact, 'A: the new mail is counted under Sent Mail Not Opened').toBe(
          notOpened0.forContact + 1,
        );
        expect(notOpened1.total, 'A: the Sent Mail Not Opened total goes up by one').toBe(
          notOpened0.total + 1,
        );
        // The contact row opens that contact's not-opened mails, which include the new one.
        const mails = page.waitForResponse((r) => r.url().includes('sentMailNotOpened'), {
          timeout: 20_000,
        });
        await page
          .getByText(/Qatest2 Bench/i)
          .filter({ visible: true })
          .last()
          .click();
        expect((await mails).status(), 'the contact’s not-opened mails load').toBe(200);
        await expect(
          page.getByText(subject, { exact: false }).first(),
          'the new mail is listed under the contact',
        ).toBeVisible({ timeout: 20_000 });
        const shot = test.info().outputPath('status-not-opened.png');
        await page.screenshot({ path: shot });
        await test.info().attach('status-not-opened', { path: shot, contentType: 'image/png' });

        const bNotSent1 = await status(b, 2, A);
        steps.push(`B reply-not-sent for A: ${bNotSent0.forContact} → ${bNotSent1.forContact}`);
        expect(bNotSent1.forContact, 'B: the new mail is counted under Reply Not Sent').toBe(
          bNotSent0.forContact + 1,
        );

        // B opens the mail → it leaves A's Sent Mail Not Opened. Opening is the content call
        // (sentAndInboxMailContent, kmailType "Received"), which is where the server marks it read.
        const opened = b.waitForResponse(
          (r) => r.url().includes('/readMail/sentAndInboxMailContent'),
          {
            timeout: 45_000,
          },
        );
        await openMail(b, subject);
        const openRes = await opened;
        steps.push(`B open call: HTTP ${openRes.status()} ${openRes.request().postData() ?? ''}`);
        // Give the server up to a minute to update the count before judging it.
        let notOpened2 = { total: 0, forContact: -1 };
        await expect
          .poll(
            async () => {
              notOpened2 = await status(page, 0, B);
              return notOpened2.forContact;
            },
            { timeout: 60_000, intervals: [5_000, 15_000, 20_000] },
          )
          .toBe(notOpened0.forContact)
          .catch(() => undefined);
        const noReply2 = await status(page, 1, B);
        steps.push(`after B opens (≤60 s) — A not-opened for B: ${notOpened2.forContact}`);
        expect(
          notOpened2.forContact,
          'A: once B opens it, it is no longer "not opened" (#1359)',
        ).toBe(notOpened0.forContact);

        // B replies → it leaves A's Reply Not Received and B's Reply Not Sent.
        await openMail(b, subject);
        await b.getByTestId('ReplyIcon').first().click();
        await b.locator('[role="menu"]').getByText('Reply', { exact: true }).first().click();
        const editor = b.locator('.ql-editor[contenteditable="true"]').last();
        await expect(editor, 'the reply composer opens').toBeVisible({ timeout: 15_000 });
        await editor.click();
        await b.keyboard.type('QA status reply');
        const sent = b.waitForResponse((r) => r.url().includes('/sentMail/postMail'), {
          timeout: 20_000,
        });
        await b
          .locator('.post_button_size')
          .filter({ has: b.locator('.icon-KP_3164') })
          .last()
          .click();
        expect((await sent).status(), 'B’s reply is sent').toBe(200);

        const noReply3 = await status(page, 1, B);
        const bNotSent3 = await status(b, 2, A);
        steps.push(
          `after B replies — A reply-not-received for B: ${noReply2.forContact} → ${noReply3.forContact}; B reply-not-sent for A: ${bNotSent3.forContact}`,
        );
        expect(noReply3.forContact, 'A: once B replies, it is no longer "reply not received"').toBe(
          noReply2.forContact - 1,
        );
        expect(bNotSent3.forContact, 'B: once B replies, it is no longer "reply not sent"').toBe(
          bNotSent0.forContact,
        );
      } finally {
        test.info().annotations.push({ type: 'observed', description: steps.join(' | ') });
        console.log(`KMAIL-STATUS ${steps.join(' | ')}`);
        await ctx.close();
      }
    });

    test('Star: starring a mail marks it important and it stays starred after a reload; unstarring undoes it @ui', async ({
      page,
      endpoints,
    }) => {
      const subject = `QA KMail star ${Date.now()}`;
      await seed(endpoints, subject);
      // The innermost block holding both this mail's subject line and a star is this mail's box.
      const star = () =>
        page
          .locator('div')
          .filter({ has: page.getByText(`Sub : ${subject}`, { exact: false }) })
          .filter({ has: page.locator('.icon-KP_43-Fav') })
          .last()
          .locator('.icon-KP_43-Fav')
          .first();
      const isGold = async () =>
        /eba708|235,\s*167,\s*8/i.test((await star().getAttribute('style')) ?? '');

      await openMail(page, subject);
      expect(await isGold(), 'a new mail starts unstarred').toBe(false);
      const marked = page.waitForResponse((r) => r.url().includes('/common/setKmailAsImportant'), {
        timeout: 20_000,
      });
      await star().click();
      expect((await marked).status(), 'the star is saved').toBe(200);
      await expect(
        page.getByText('Mail marked as important', { exact: false }).first(),
      ).toBeVisible({ timeout: 10_000 });

      await openMail(page, subject);
      const shot = test.info().outputPath('star-after-reload.png');
      await page.screenshot({ path: shot });
      await test.info().attach('star-after-reload', { path: shot, contentType: 'image/png' });
      expect(await isGold(), 'the mail is still starred after a reload').toBe(true);

      const unmarked = page.waitForResponse(
        (r) => r.url().includes('/common/setKmailAsImportant'),
        { timeout: 20_000 },
      );
      await star().click();
      expect((await unmarked).status(), 'the unstar is saved').toBe(200);
      await expect(
        page.getByText('Mail marked as unimportant', { exact: false }).first(),
      ).toBeVisible({ timeout: 10_000 });
      await openMail(page, subject);
      expect(await isGold(), 'the mail is unstarred after a reload').toBe(false);
    });

    test('Priority: a mail sent as High priority is sent with priority 2 and shows the High icon to the receiver @ui', async ({
      page,
      browser,
    }) => {
      test.skip(
        process.env.KATCHUP_UI_LIFECYCLE !== 'true',
        'needs auth2.setup.ts for the 2nd account; set KATCHUP_UI_LIFECYCLE=true',
      );
      const subject = `QA KMail priority ${Date.now()}`;
      const req = await sendFromUi(page, testData.victimKpostId, subject, 'High');
      test.info().annotations.push({
        type: 'observed',
        description: `postMail priority=${String(req.priority)}`,
      });
      expect(req.priority, 'High is sent as priority 2').toBe(2);

      const ctx = await browser.newContext({ storageState: STORAGE_STATE_2 });
      const b = await ctx.newPage();
      try {
        await openMail(b, subject);
        const box = b
          .locator('div')
          .filter({ has: b.getByText(`Sub : ${subject}`, { exact: false }) })
          .filter({ has: b.locator('[class*="Pri-"], [class*="pri-"]') })
          .last();
        const shot = test.info().outputPath('priority-receiver.png');
        await b.screenshot({ path: shot });
        await test.info().attach('priority-receiver', { path: shot, contentType: 'image/png' });
        await expect(
          box.locator('.icon-KP_78-Pri-High').first(),
          'the receiver sees the High priority icon on the mail',
        ).toBeVisible({ timeout: 15_000 });
      } finally {
        await ctx.close();
      }
    });

    test('Voice search: what the mic hears is put in the Recents search and finds the mail @ui', async ({
      page,
      endpoints,
    }) => {
      const subject = `QA KMail voice ${Date.now()}`;
      await seed(endpoints, subject);
      // A stand-in speech recogniser: start() → onstart, then "hears" the subject, then ends.
      await page.addInitScript((heard: string) => {
        class FakeRecognition {
          continuous = false;
          interimResults = false;
          lang = 'en-IN';
          onstart: (() => void) | null = null;
          onend: (() => void) | null = null;
          onresult: ((e: unknown) => void) | null = null;
          onerror: ((e: unknown) => void) | null = null;
          start() {
            setTimeout(() => this.onstart?.(), 50);
            setTimeout(() => {
              this.onresult?.({ results: [[{ transcript: heard }]] });
              this.onend?.();
            }, 400);
          }
          stop() {
            this.onend?.();
          }
        }
        const w = window as unknown as Record<string, unknown>;
        w.SpeechRecognition = FakeRecognition;
        w.webkitSpeechRecognition = FakeRecognition;
      }, subject);
      await openKmail(page);
      const search = page.locator('.Serach_input').filter({ visible: true }).first();
      // The mic sits next to the visible Recents search box.
      await search
        .locator('xpath=ancestor::div[contains(@class,"justify-content-around")][1]')
        .locator('.icon-KP_53-Mic-on')
        .first()
        .click();
      await expect(search, 'the heard text is put in the search box').toHaveValue(subject, {
        timeout: 10_000,
      });
      await expect(
        page.getByText(subject, { exact: false }).first(),
        'the search finds the mail',
      ).toBeVisible({ timeout: 30_000 });
    });

    test('Clear All: empties a Status of Mails list, stays empty after a reload, and deletes no mail @ui', async ({
      page,
      endpoints,
    }) => {
      // Clear All (StatusType.js → POST /common/clearStatusOfAllKmailsContacts {kmailStatusFlag,
      // selectMailType:"A"}) only sets a "cleared" flag on the last 30 days' rows
      // (CommonDaoImpl.clearAllKmail* → SET … = 'C'); it must not touch the mails themselves.
      // Uses "Reply Not Sent" (mail received, not replied) with a fresh mail from qatest3.
      const subject = `QA KMail clear all ${Date.now()}`;
      await seed(endpoints, subject);
      const before = await status(page, 2, testData.personal3KpostId);
      expect(before.forContact, 'the new mail is listed under Reply Not Sent').toBeGreaterThan(0);

      const clearBtn = page.locator('.clearBtn').filter({ visible: true }).first();
      const cleared = page.waitForResponse(
        (r) => r.url().includes('/common/clearStatusOfAllKmailsContacts'),
        { timeout: 20_000 },
      );
      await clearBtn.click();
      const res = await cleared;
      const reqBody = res.request().postData() ?? '';
      const resText = (await res.text().catch(() => '')).slice(0, 200);
      test.info().annotations.push({
        type: 'observed',
        description: `before: total ${before.total}, qatest3 ${before.forContact} | clear ${reqBody} -> HTTP ${res.status()} ${resText}`,
      });
      expect(res.status(), `Clear All is accepted: ${resText}`).toBe(200);
      await expect(
        page.getByText('All contacts cleared successfully!', { exact: false }).first(),
      ).toBeVisible({ timeout: 10_000 });
      await expect(
        page.getByText('No Data Found', { exact: true }).filter({ visible: true }).first(),
        'the list is empty right away',
      ).toBeVisible({ timeout: 10_000 });

      // Clearing an already-empty list must not report an error.
      const again = page.waitForResponse(
        (r) => r.url().includes('/common/clearStatusOfAllKmailsContacts'),
        { timeout: 20_000 },
      );
      await page.locator('.clearBtn').filter({ visible: true }).first().click();
      const res2 = await again;
      const res2Text = (await res2.text().catch(() => '')).slice(0, 200);
      // The app's toast appears right after the reply; give it 5 s to show before judging.
      const errorShown = await page
        .getByText('Something Went Wrong', { exact: false })
        .first()
        .waitFor({ state: 'visible', timeout: 5_000 })
        .then(() => true)
        .catch(() => false);
      const shot = test.info().outputPath('clear-all-empty.png');
      await page.screenshot({ path: shot });
      await test.info().attach('clear-all-empty', { path: shot, contentType: 'image/png' });
      test.info().annotations.push({
        type: 'observed',
        description: `Clear All on an empty list -> HTTP ${res2.status()} ${res2Text}; error toast shown: ${errorShown}`,
      });

      // The mail itself is untouched: it still opens normally.
      await openMail(page, subject);
      // Clear All on an empty list answers 400 "unable to clear Mails" and the app shows "Something
      // Went Wrong !" — that 400 was reported as #681 and closed INVALID (judged not a defect), so
      // it is only recorded in the observation above, not asserted.

      // After a reload the list must stay empty — and opening the empty list must not crash the
      // page (the server sends "data":"No Content" for an empty list — #1362).
      const after = await status(page, 2, testData.personal3KpostId);
      const shotEmpty = test.info().outputPath('clear-all-after-reload.png');
      await page.screenshot({ path: shotEmpty });
      await test.info().attach('clear-all-after-reload', {
        path: shotEmpty,
        contentType: 'image/png',
      });
      test.info().annotations.push({
        type: 'observed',
        description: `after reload: total ${after.total}, qatest3 ${after.forContact}; list reply ${after.raw}`,
      });
      expect(after.total, 'Reply Not Sent stays empty after a reload').toBe(0);
      await expect(
        page.getByText('No Data Found', { exact: true }).filter({ visible: true }).first(),
        'the emptied list opens and shows "No Data Found" — not a crashed page (#1362)',
      ).toBeVisible({ timeout: 10_000 });
    });

    test('opening KMail shows no pop-up alert, whatever the browser’s speech support @ui', async ({
      page,
      browserName,
    }) => {
      // common/MicInput calls alert("Microphone not available in this browser") as soon as it
      // mounts when the browser has no SpeechRecognition — on every page with a search bar.
      const dialogs: string[] = [];
      page.on('dialog', (d) => {
        dialogs.push(`${d.type()}: ${d.message()}`);
        void d.dismiss().catch(() => undefined);
      });
      await openKmail(page);
      await page.locator('.Serach_input').first().waitFor({ state: 'attached', timeout: 20_000 });
      const hasSpeech = await page.evaluate(
        () => 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window,
      );
      test.info().annotations.push({
        type: 'observed',
        description: `${browserName}: speech recognition available=${hasSpeech}; pop-ups: ${dialogs.join(' | ') || 'none'}`,
      });
      const shot = test.info().outputPath('kmail-open.png');
      await page.screenshot({ path: shot });
      await test.info().attach('kmail-open', { path: shot, contentType: 'image/png' });
      expect(dialogs, 'opening KMail raises no browser pop-up alert (#1360)').toEqual([]);
    });
  },
);
