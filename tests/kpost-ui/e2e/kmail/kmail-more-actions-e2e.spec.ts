import type { Locator, Page, Response } from '@playwright/test';
import { mailShape } from '@api/definitions/kmail/send.api';
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';

/**
 * KMail actions with no end-to-end test yet, each server answer checked: Translate a received mail;
 * Save Draft → open it from Status of Mails › Draft Mails → send (the draft is then deleted);
 * delete a draft; a custom salutation added, edited and deleted in the composer; one "Sent Mail Not
 * Opened" status cleared; and multi-select Copy and Delete. Seed mails come from qatest3 over the
 * API (its browser session is reused). Selectors from components/Kmail/components/* (KmailMessage,
 * KmailMessageBox, StatusType, WriteMailPage).
 */
const C: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal-3')!;

const waitLoaded = (page: Page) =>
  page
    .locator('.loader-overlay')
    .waitFor({ state: 'hidden', timeout: 30_000 })
    .catch(() => undefined);

async function answerTo(page: Page, path: string, act: () => Promise<void>): Promise<Response> {
  const answer = page.waitForResponse((r) => r.url().includes(path), { timeout: 30_000 });
  await act();
  return answer;
}
const envelope = async (r: Response) =>
  (await r.json().catch(() => ({}))) as { status?: string; message?: string; data?: unknown };
const toast = (page: Page, text: RegExp | string): Locator =>
  page.locator('.Toastify__toast').filter({ hasText: text }).first();
const dialog = (page: Page, title: string): Locator =>
  page
    .locator('.modal-dialog')
    .filter({ has: page.locator('.modal-title', { hasText: title }) })
    .last();

async function seedFromC(endpoints: EndpointExecutor, subject: string): Promise<void> {
  const sent = await endpoints.sendTo(
    'kmail-post-mail',
    { body: mailShape({ toAddress: testData.kpostId, kmailSubject: subject }) },
    { label: 'kmail-more:seed', auth: { principal: C }, allowLiveWrite: true },
  );
  expect(sent.status, 'qatest3 sends qatest1 a mail (setup)').toBe(200);
}

async function openMail(page: Page, subject: string): Promise<void> {
  await page.goto('/kmail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await waitLoaded(page);
  await page.locator('.Serach_input').first().fill(subject);
  await page.getByText(subject, { exact: false }).first().click({ timeout: 30_000 });
  await expect(page.getByText(`Sub : ${subject}`, { exact: false }).first()).toBeVisible({
    timeout: 20_000,
  });
}

/** /writemail with To, Subject and body filled (not sent). */
async function compose(page: Page, to: string, subject: string): Promise<void> {
  await page.goto('/writemail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await waitLoaded(page);
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
  await page.locator('.ql-editor[contenteditable="true"]').first().click();
  await page.keyboard.type(`QA bench body ${subject}`);
}

async function saveDraft(page: Page): Promise<Response> {
  // The composer's own menu (next to the date chip), not the contact list's three dots.
  await page.locator('.writeMailDateChipMore').filter({ visible: true }).first().click();
  return answerTo(page, '/draft/draftMail', () =>
    page.getByText('Save Draft', { exact: true }).filter({ visible: true }).first().click(),
  );
}

async function openDrafts(page: Page): Promise<Locator> {
  await page.goto('/kmail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await waitLoaded(page);
  await page.getByRole('tab', { name: 'Status of Mails' }).first().click();
  await page.getByText('Draft Mails', { exact: true }).first().click();
  const panel = page.locator('.shadowbowName', { hasText: 'Draft Mails' }).first();
  await expect(panel, 'the Draft Mails panel opens').toBeVisible({ timeout: 20_000 });
  return page.locator('.darfatFill');
}

test.describe(
  'KPost KMail · translate, drafts, salutations, status clear and multi-select @ui',
  { tag: ['@ui', '@kmail', '@regression'] },
  () => {
    test.describe.configure({ mode: 'default', timeout: 240_000 });
    test.skip(
      process.env.KMAIL_UI_LIFECYCLE !== 'true',
      'sends real mails; set KMAIL_UI_LIFECYCLE=true',
    );
    test.skip(
      !testData.kpostId || !testData.personal3KpostId,
      'needs the qatest1 and qatest3 accounts',
    );

    test('a received mail is translated to Tamil and the translation is shown', async ({
      page,
      endpoints,
    }) => {
      const subject = `QA translate ${Date.now()}`;
      await seedFromC(endpoints, subject);
      await openMail(page, subject);
      await page.locator('.icon-KP_75-translate').first().click();
      const picker = dialog(page, 'Translate');
      await picker.getByPlaceholder('Search').fill('Tamil');
      const translated = await answerTo(page, '/translator/translation', () =>
        picker.locator('.language_Font', { hasText: 'Tamil' }).first().click(),
      );
      const sent = JSON.parse(translated.request().postData() ?? '{}') as { langTo?: string };
      expect.soft(sent.langTo, 'Tamil is asked for').toBe('ta');
      const body = await envelope(translated);
      expect.soft(body.status, 'the translation service answers').toBe('SUCCESS');
      await expect.soft(toast(page, 'Mail Translated')).toBeVisible();
      await expect
        .soft(
          page
            .locator('.sub_fontKM.font')
            .filter({ hasText: /English/ })
            .first(),
        )
        .toBeVisible({ timeout: 15_000 });
    });

    test('a saved draft opens from Draft Mails and sends, and the draft is then removed', async ({
      page,
    }) => {
      const subject = `QA draft send ${Date.now()}`;
      await compose(page, testData.personal3KpostId, subject);
      const saved = await saveDraft(page);
      expect((await envelope(saved)).status, 'the draft is saved').toBe('SUCCESS');

      const cards = await openDrafts(page);
      const card = cards.filter({ hasText: subject }).first();
      await expect(card, 'the draft is listed').toBeVisible({ timeout: 20_000 });
      await card.locator('.icon-KP_02-Write-Letter').first().click();
      await expect(page.locator('input[aria-label="Subject"]').first()).toHaveValue(subject, {
        timeout: 20_000,
      });
      const deletedDraft = page.waitForResponse((r) => r.url().includes('/draft/deleteDraftMail'), {
        timeout: 40_000,
      });
      const posted = await answerTo(page, '/sentMail/postMail', () =>
        page.locator('button[aria-label="Send mail"]').first().click(),
      );
      expect.soft(posted.status(), 'the draft is sent').toBe(200);
      const after = await deletedDraft.catch(() => undefined);
      expect.soft(after?.status(), 'and the sent draft is removed from Draft Mails').toBe(200);
    });

    test('a draft is deleted from Draft Mails', async ({ page }) => {
      const subject = `QA draft delete ${Date.now()}`;
      await compose(page, testData.personal3KpostId, subject);
      expect((await envelope(await saveDraft(page))).status, 'the draft is saved').toBe('SUCCESS');
      const cards = await openDrafts(page);
      const card = cards.filter({ hasText: subject }).first();
      await expect(card, 'the draft is listed').toBeVisible({ timeout: 20_000 });
      const deleted = await answerTo(page, '/draft/deleteDraftMail', () =>
        card.locator('.icon-KP_29-Delete').first().click(),
      );
      expect.soft((await envelope(deleted)).status, 'the server deletes it').toBe('SUCCESS');
      await expect.soft(toast(page, 'Draft Mail Deleted Successfully')).toBeVisible();
      await expect.soft(card, 'the card goes away').toBeHidden({ timeout: 15_000 });
    });

    test('a custom salutation is added, edited and deleted in the composer', async ({ page }) => {
      const word = `QABench${String(Date.now()).slice(-6)}`;
      const edited = `${word}x`;
      await page.goto('/writemail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await waitLoaded(page);
      const kebab = page.locator('span.pluscircle svg').first();
      const salutation = page.getByPlaceholder('Select Salutation').first();
      const pick = async (text: string) => {
        await salutation.click();
        await salutation.fill(text);
        await page
          .locator('.custom-dropdown-menu .custom-dropdown-item', { hasText: text })
          .first()
          .click();
      };

      await test.step('Add', async () => {
        await kebab.click();
        await page.locator('.OPtionCardPosition .optionstyle', { hasText: 'Add' }).first().click();
        await page.getByPlaceholder('Enter Salutation.....').fill(word);
        const added = await answerTo(page, '/kmailSetting/saveOrUpdateCustomizedSaluations', () =>
          page.getByRole('button', { name: /^Add$/ }).last().click(),
        );
        expect((await envelope(added)).status, 'the server adds it').toBe('SUCCESS');
      });

      await test.step('Edit', async () => {
        await pick(word);
        await kebab.click();
        await page.locator('.OPtionCardPosition .optionstyle', { hasText: 'Edit' }).first().click();
        await page.getByPlaceholder('Enter Salutation.....').fill(edited);
        const updated = await answerTo(page, '/kmailSetting/saveOrUpdateCustomizedSaluations', () =>
          page
            .getByRole('button', { name: /^Update$/ })
            .last()
            .click(),
        );
        const sent = JSON.parse(updated.request().postData() ?? '{}') as { saluationID?: unknown };
        expect.soft(sent.saluationID, 'the edit names the salutation').toBeTruthy();
        expect.soft((await envelope(updated)).status, 'the server updates it').toBe('SUCCESS');
      });

      await test.step('Delete', async () => {
        await pick(edited);
        await kebab.click();
        await page
          .locator('.OPtionCardPosition .optionstyle', { hasText: 'Delete' })
          .first()
          .click();
        const confirm = dialog(page, 'Confirmation For Delete Salutation');
        const deleted = await answerTo(page, '/kmailSetting/deleteCustomizedSaluation', () =>
          confirm.getByRole('button', { name: /^Confirm$/ }).click(),
        );
        expect.soft((await envelope(deleted)).status, 'the server deletes it').toBe('SUCCESS');
      });
    });

    test('one "Sent Mail Not Opened" status is cleared from its mail', async ({ page }) => {
      const subject = `QA clear status ${Date.now()}`;
      await compose(page, testData.personal3KpostId, subject);
      const sent = await answerTo(page, '/sentMail/postMail', () =>
        page
          .locator('.post_button_size')
          .filter({ has: page.locator('.icon-KP_3164') })
          .first()
          .click(),
      );
      expect(sent.status(), 'the mail is sent (setup)').toBe(200);

      await page.goto('/kmail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await waitLoaded(page);
      await page.getByRole('tab', { name: 'Status of Mails' }).first().click();
      await page
        .getByText('Sent Mail Not Opened', { exact: false })
        .filter({ visible: true })
        .first()
        .click();
      // The contact's row inside the "Sent Mail Not Opened" panel (since 2026-10-31 a plain name
      // row; a .contactBar_Dropdown of the same name sits off-screen in the hidden Recents tab).
      await page
        .locator('div')
        .filter({ has: page.getByText('Sent Mail Not Opened', { exact: true }) })
        .filter({ has: page.getByText(/^Qatest3 Bench$/i) })
        .last()
        .getByText(/^Qatest3 Bench$/i)
        .last()
        .click({ timeout: 20_000 });
      const mail = page.locator('[id]').filter({ hasText: subject }).last();
      await expect(mail, 'the unopened mail is listed').toBeVisible({ timeout: 20_000 });
      const cleared = await answerTo(page, '/common/clearStatusOfKmailsContacts', () =>
        mail.locator('.icon-KP_29-Delete.message-icon-colorred').first().click(),
      );
      expect.soft((await envelope(cleared)).status, 'the server clears the status').toBe('SUCCESS');
    });

    test('multi-select copies one mail to the clipboard and deletes it', async ({
      page,
      endpoints,
    }) => {
      const subject = `QA multi ${Date.now()}`;
      await seedFromC(endpoints, subject);
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      await openMail(page, subject);
      await page.locator('.icon-KP_59-More-Lined.icon-font-kmail').first().click();
      const card = page.locator('[id]').filter({ hasText: subject }).last();
      await card.locator('.abMail_CheckBox input[type=checkbox]').first().check();

      await test.step('Copy', async () => {
        const copied = await answerTo(page, '/readMail/sentAndInboxMailContent', () =>
          page.locator('.typographyforForwardFooter', { hasText: 'Copy' }).first().click(),
        );
        expect.soft(copied.status(), 'the mail content is read for the copy').toBe(200);
        await expect.soft(toast(page, 'Mail copied to clipboard')).toBeVisible();
        const text = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
        expect.soft(text, 'the clipboard holds the mail').toContain('QA');
      });

      await test.step('Delete', async () => {
        page.once('dialog', (d) => void d.accept());
        const deleted = await answerTo(page, '/common/deleteKmailWithDeletedBy', () =>
          page.locator('.typographyforForwardFooter', { hasText: 'Delete' }).first().click(),
        );
        expect.soft((await envelope(deleted)).status, 'the server deletes it').toBe('SUCCESS');
        await expect.soft(toast(page, 'Mail Deleted Successfully')).toBeVisible();
      });
    });
  },
);
