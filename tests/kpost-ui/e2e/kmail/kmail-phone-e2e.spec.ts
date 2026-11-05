import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { mailShape } from '@api/definitions/kmail/send.api';
import type { Locator, Page } from '@playwright/test';

/**
 * KMail at phone size (390×844), where one panel shows at a time: open a mail, then write and send one.
 * The page must never scroll sideways and controls must sit on screen. Seed mail comes from qatest3.
 */
const C: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal-3')!;
const PHONE = { width: 390, height: 844 };

test.describe(
  'KPost KMail · phone-size screen @ui',
  { tag: ['@ui', '@kmail', '@regression'] },
  () => {
    test.describe.configure({ timeout: 150_000 });
    test.skip(
      process.env.KMAIL_UI_LIFECYCLE !== 'true',
      'sends real mails; set KMAIL_UI_LIFECYCLE=true',
    );
    test.skip(
      !testData.kpostId || !testData.personal3KpostId,
      'needs both QA accounts, qatest1 and qatest3',
    );
    test.use({ viewport: PHONE });

    const waitLoaded = (page: Page) =>
      page
        .locator('.loader-overlay')
        .waitFor({ state: 'hidden', timeout: 30_000 })
        .catch(() => undefined);

    /** How far the page scrolls sideways (0 = fits the screen). */
    const overflow = (page: Page) =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );

    /** The control is fully inside the phone screen horizontally. */
    async function expectOnScreen(el: Locator, what: string): Promise<void> {
      await expect(el, `${what} is shown`).toBeVisible({ timeout: 20_000 });
      const box = await el.boundingBox();
      expect(box, `${what} has a position`).not.toBeNull();
      expect(box!.x, `${what} does not start off the left edge`).toBeGreaterThanOrEqual(-1);
      expect(box!.x + box!.width, `${what} does not run off the right edge`).toBeLessThanOrEqual(
        PHONE.width + 1,
      );
    }

    async function shot(page: Page, name: string): Promise<void> {
      const file = test.info().outputPath(`${name}.png`);
      await page.screenshot({ path: file });
      await test.info().attach(name, { path: file, contentType: 'image/png' });
    }

    test('find and open a received mail on a phone @ui', async ({ page, endpoints }) => {
      const subject = `QA KMail phone open ${Date.now()}`;
      const sent = await endpoints.sendTo(
        'kmail-post-mail',
        { body: mailShape({ toAddress: testData.kpostId, kmailSubject: subject }) },
        { label: 'phone:seed', auth: { principal: C }, allowLiveWrite: true },
      );
      expect(sent.status, 'qatest3 sends qatest1 a mail').toBe(200);

      await page.goto('/kmail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await waitLoaded(page);
      const search = page.locator('.Serach_input').filter({ visible: true }).first();
      await expectOnScreen(search, 'the Recents search box');
      expect(await overflow(page), 'the mail list does not scroll sideways').toBeLessThanOrEqual(1);
      await shot(page, 'phone-recents');

      await search.fill(subject);
      const row = page.getByText(subject, { exact: false }).filter({ visible: true }).first();
      await expectOnScreen(row, 'the found mail');
      await row.click();
      const opened = page
        .getByText(`Sub : ${subject}`, { exact: false })
        .filter({ visible: true })
        .first();
      await expectOnScreen(opened, 'the opened mail’s subject line');
      await expectOnScreen(
        page.getByTestId('ReplyIcon').filter({ visible: true }).first(),
        'the reply arrow',
      );
      await shot(page, 'phone-opened');
      expect(await overflow(page), 'the opened mail does not scroll sideways').toBeLessThanOrEqual(
        1,
      );
    });

    test('write and send a mail on a phone @ui', async ({ page }) => {
      const subject = `QA KMail phone send ${Date.now()}`;
      await page.goto('/writemail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await waitLoaded(page);
      const to = page
        .locator('.subjectTextboxKmailTO, input[name="to"]')
        .filter({ visible: true })
        .first();
      const subjectBox = page.locator('.toInput').filter({ visible: true }).first();
      const editor = page
        .locator('.ql-editor[contenteditable="true"]')
        .filter({ visible: true })
        .first();
      const sendBtn = page
        .locator('.post_button_size')
        .filter({ has: page.locator('.icon-KP_3164') })
        .filter({ visible: true })
        .first();
      await expectOnScreen(to, 'the To field');
      await expectOnScreen(subjectBox, 'the Subject field');
      await expectOnScreen(editor, 'the mail text box');
      await shot(page, 'phone-compose');
      expect(await overflow(page), 'Write Mail does not scroll sideways').toBeLessThanOrEqual(1);

      await to.click();
      await to.fill(testData.personal3KpostId);
      await page
        .locator('.suggestion-dropdown')
        .getByText(testData.personal3KpostId, { exact: false })
        .first()
        .click({ timeout: 4_000 })
        .catch(() => undefined);
      await page.keyboard.press('Escape').catch(() => undefined);
      await subjectBox.fill(subject);
      await editor.click();
      await page.keyboard.type(`QA phone body ${subject}`);
      await sendBtn.scrollIntoViewIfNeeded();
      await expectOnScreen(sendBtn, 'the Send button');
      const send = page.waitForResponse((r) => r.url().includes('/sentMail/postMail'), {
        timeout: 20_000,
      });
      await sendBtn.click();
      const res = await send;
      const req = (res.request().postDataJSON() ?? {}) as Record<string, unknown>;
      expect(res.status(), 'the mail is sent from the phone layout').toBe(200);
      expect(req.toAddress, 'it goes to the chosen contact').toBe(testData.personal3KpostId);
      expect(req.kmailSubject, 'with the typed subject').toBe(subject);
    });
  },
);
