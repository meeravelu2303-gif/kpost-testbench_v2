import type { Locator, Page } from '@playwright/test';
import { AUTH_PROFILES } from '@config/auth-profile';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { waitLoaded } from '../journeys/support/journey';
import { countRequests, toast } from '../support/validation';

/**
 * KMail compose refuses invalid input before sending (WriteMailPage.js PostMail and the To/Subject
 * handlers): no recipient, a malformed address, no subject, no body, and a subject over 70
 * characters. Each case checks the message the user sees and that /sentMail/postMail was never
 * called. Nothing is sent, so nothing is written.
 */

const POST_MAIL = '/sentMail/postMail';

async function openCompose(page: Page) {
  await page.goto('/writemail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await waitLoaded(page);
  const subject = page.locator('.toInput').first();
  // Late in a run /writemail can restore the last opened conversation instead of a blank compose.
  if (!(await subject.isVisible({ timeout: 8_000 }).catch(() => false))) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitLoaded(page);
  }
  return {
    to: page.locator('.subjectTextboxKmailTO, input[name="to"]').first(),
    subject,
    body: page.locator('.ql-editor[contenteditable="true"]').first(),
    send: page.getByRole('button', { name: 'Send mail' }).first(),
  };
}

/** Picks a recipient the way a user does: type the address, choose the suggestion. */
async function chooseRecipient(page: Page, to: Locator, address: string) {
  await to.click();
  await to.fill(address);
  await page
    .locator('.suggestion-dropdown')
    .getByText(address, { exact: false })
    .first()
    .click({ timeout: 4_000 })
    .catch(() => to.press('Enter'));
  // The Suggestions pop-up covers Subject and the body until it is closed.
  await page.keyboard.press('Escape');
}

test.describe(
  'KPost KMail · compose refuses invalid input before sending',
  { tag: ['@ui', '@kmail', '@regression'] },
  () => {
    test.skip(!testData.personal3KpostId, 'needs the 3rd QA account (QA_PERSONAL_3_KPOST_ID)');

    test('Send with no recipient is refused and nothing is sent', async ({ page }) => {
      const form = await openCompose(page);
      const posted = countRequests(page, POST_MAIL);
      await form.subject.fill('QA validation: no recipient');
      await form.body.click();
      await page.keyboard.type('QA bench body');
      await form.send.click();
      await expect(toast(page, 'Invalid mail ID format'), 'the user is told why').toBeVisible({
        timeout: 10_000,
      });
      expect(posted(), 'a mail with no recipient never reaches the server').toBe(0);
    });

    test('a malformed address typed in To is refused and cleared', async ({ page }) => {
      const form = await openCompose(page);
      await form.to.click();
      await form.to.fill('not-an-address');
      // Enter accepts the typed address (the Suggestions pop-up would cover Subject for a click).
      await form.to.press('Enter');
      await expect(toast(page, 'Invalid email id'), 'the user is told why').toBeVisible({
        timeout: 10_000,
      });
      await expect(form.to, 'the bad address is removed from To').toHaveValue('');
    });

    test('Send with no subject is refused and nothing is sent', async ({ page }) => {
      const form = await openCompose(page);
      await chooseRecipient(page, form.to, testData.personal3KpostId);
      await form.body.click();
      await page.keyboard.type('QA bench body');
      const posted = countRequests(page, POST_MAIL);
      await form.send.click();
      await expect(toast(page, 'Subject cannot be empty'), 'the user is told why').toBeVisible({
        timeout: 10_000,
      });
      expect(posted(), 'a mail with no subject never reaches the server').toBe(0);
    });

    test('Send with no body is refused and nothing is sent', async ({ page }) => {
      const form = await openCompose(page);
      await chooseRecipient(page, form.to, testData.personal3KpostId);
      await form.subject.fill('QA validation: no body');
      const posted = countRequests(page, POST_MAIL);
      await form.send.click();
      await expect(toast(page, 'Mail Content cannot be empty'), 'the user is told why').toBeVisible(
        { timeout: 10_000 },
      );
      expect(posted(), 'a mail with no body never reaches the server').toBe(0);
    });

    test('the subject stops at 70 characters and says so', async ({ page }) => {
      const form = await openCompose(page);
      await form.subject.click();
      await page.keyboard.type('Q'.repeat(80));
      expect(await form.subject.inputValue(), 'the subject holds 70 characters').toHaveLength(70);
      await expect(
        toast(page, 'You’ve reached the maximum 70 characters!'),
        'the user is told the limit',
      ).toBeVisible({ timeout: 10_000 });
    });

    test('a salutation is required to send', async ({ page }) => {
      const form = await openCompose(page);
      await chooseRecipient(page, form.to, testData.personal3KpostId);
      await form.subject.fill('QA validation: no salutation');
      await form.body.click();
      await page.keyboard.type('QA bench body');
      await page.getByPlaceholder('Select Salutation').first().fill('');
      await page.keyboard.press('Escape');
      const posted = countRequests(page, POST_MAIL);
      await form.send.click();
      await expect(toast(page, 'Saluation Cannot Be Empty!'), 'the user is told why').toBeVisible({
        timeout: 10_000,
      });
      expect(posted(), 'a mail with no salutation never reaches the server').toBe(0);
    });

    test('a new salutation refuses special characters', async ({ page }) => {
      await page.route(/salutation|saluation/i, (route) =>
        route.request().method() === 'GET' ? route.continue() : route.abort(),
      );
      await openCompose(page);
      // The salutation's more-options (⋮) → Add opens the new-salutation field.
      await page.locator('.pluscircle svg').first().click();
      await page
        .locator('.optionstyle')
        .filter({ hasText: /^\s*Add\s*$/ })
        .first()
        .click();
      const field = page.getByPlaceholder('Enter Salutation.....').first();
      await field.pressSequentially('Dear@#Sir');
      await expect(
        toast(page, 'Special Characters are not Allowed!'),
        'the user is told why',
      ).toBeVisible({ timeout: 10_000 });
      await expect(field, 'the special characters are dropped').toHaveValue('DearSir');
    });

    test('Save Draft with nothing written is refused', async ({ page }) => {
      await openCompose(page);
      const drafted = countRequests(page, '/draft/draftMail');
      // Nothing typed anywhere: typing and deleting in the body would leave "<p><br></p>".
      await page.locator('.icon-KP_95-Write-Mail-Temp').first().click();
      await expect(
        toast(page, 'To or Subject or Mail Content Field cannot be empty'),
        'the user is told there is nothing to save',
      ).toBeVisible({ timeout: 10_000 });
      expect(drafted(), 'no empty draft reaches the server').toBe(0);
    });

    test('Add copies refuses an outside address that is not an e-mail', async ({ page }) => {
      // Nothing may store it as an outside contact.
      await page.route(/addOtherDomainContacts/i, (route) => route.abort());
      const form = await openCompose(page);
      // Add copies opens only once To holds a valid recipient (WriteMailPage.js isInputValid).
      await chooseRecipient(page, form.to, testData.victimKpostId);
      await page
        .getByText(/^Add copies$/)
        .first()
        .click();
      const field = page.getByPlaceholder('Enter Other Domain Mail').first();
      await expect(field, 'the outside-address field is offered').toBeVisible({ timeout: 10_000 });
      await field.fill('not-an-email');
      await page.locator('.cc-add-button').first().click();
      await expect(toast(page, 'Invalid email address'), 'the user is told why').toBeVisible({
        timeout: 10_000,
      });
    });

    test('Forward with more than ten mails selected is refused', async ({ page }) => {
      await page.route(/forward/i, (route) => route.abort());
      await page.goto('/kmail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await waitLoaded(page);
      await page
        .getByText(/^qatest3 bench$/i)
        .filter({ visible: true })
        .first()
        .click({ timeout: 20_000 });
      await page
        .locator('.icon-KP_59-More-Lined.icon-font-kmail')
        .first()
        .click({ timeout: 15_000 });
      await page.locator('input.selectAllCheck').first().check();
      const ticked = await page.locator('.abMail_CheckBox input[type=checkbox]:checked').count();
      test.skip(ticked <= 10, 'needs provisioned conversation with more than ten loaded mails');
      await page.locator('.icon-KP_119-Forward').last().click();
      await expect(
        toast(page, 'Only up to 10 messages should be able to be forward'),
        'the user is told the limit',
      ).toBeVisible({ timeout: 10_000 });
    });

    test('Copy with more than one mail selected is refused', async ({ page }) => {
      await page.goto('/kmail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await waitLoaded(page);
      // The conversation with the 3rd QA account holds many mails (qatest3 mails qatest1 in other specs).
      await page
        // The name is lower case in the page and capitalised by CSS.
        .getByText(/^qatest3 bench$/i)
        .filter({ visible: true })
        .first()
        .click({ timeout: 20_000 });
      await page
        .locator('.icon-KP_59-More-Lined.icon-font-kmail')
        .first()
        .click({ timeout: 15_000 });
      await page.locator('input.selectAllCheck').first().check();
      await page.locator('.icon-KP_44-Copy').last().click();
      await expect(
        toast(page, 'Only one mail can be selected at a time.'),
        'the user is told only one mail can be copied',
      ).toBeVisible({ timeout: 10_000 });
    });

    test('Edit and Delete of a salutation need one chosen in the box', async ({
      page,
      endpoints,
    }) => {
      const me = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal');
      test.skip(!me, 'needs provisioned browser account principal');
      // A custom salutation of this run (only custom ones offer Edit / Delete), removed afterwards.
      const marker = `QA Sal ${Date.now()}`;
      const as = { auth: { principal: me! }, allowLiveWrite: true };
      const saved = await endpoints.sendTo(
        'kmail-save-saluation',
        { body: { saluationID: '', saluation: marker } },
        { label: 'kmail-validation:sal-save', ...as },
      );
      expect(saved.status, 'the custom salutation is saved (setup)').toBeLessThan(300);
      try {
        // Nothing the screen does may change salutations on the server.
        await page.route(/saveOrUpdateCustomizedSaluations|deleteCustomizedSaluation/i, (route) =>
          route.abort(),
        );
        await openCompose(page);
        const box = page.getByPlaceholder('Select Salutation').first();
        await box.click();
        await box.fill(marker);
        await page.getByText(marker, { exact: true }).last().click({ timeout: 10_000 });
        // Then the box is emptied: Edit and Delete now have no salutation to act on.
        await box.fill('');
        for (const [action, rule] of [
          ['Edit', 'Before Edit Please Select the Salutation'],
          ['Delete', 'Before Delete Please Select the Saluation'],
        ] as const) {
          await page.locator('.pluscircle svg').first().click();
          await page
            .locator('.optionstyle')
            .filter({ hasText: new RegExp(`^\\s*${action}\\s*$`) })
            .first()
            .click();
          await expect(toast(page, rule), `${action} is refused: ${rule}`).toBeVisible({
            timeout: 10_000,
          });
        }
      } finally {
        const list = await endpoints.sendTo(
          'kmail-saluations',
          {},
          { label: 'kmail-validation:sal-list', auth: { principal: me! } },
        );
        const entry = (
          JSON.parse(list.bodyText || '{}') as {
            data?: Array<{ saluationID: string; saluation: string }>;
          }
        ).data?.find((s) => s.saluation === marker);
        if (entry) {
          await endpoints.sendTo(
            'kmail-delete-saluation',
            { body: { saluationID: entry.saluationID } },
            { label: 'kmail-validation:sal-delete', ...as },
          );
        }
      }
    });

    test('bulk mail refuses an Excel file with no e-mail ids', async ({ page }) => {
      await openCompose(page);
      const bulk = page.getByText('Bulk Mail', { exact: true }).first();
      test.skip(
        !(await bulk.isVisible({ timeout: 3_000 }).catch(() => false)),
        'Bulk Mail is not offered on this build (its button is commented out in WriteMailPage.js)',
      );
      await bulk.click();
      // XLSX.read parses CSV bytes as well, so a one-column sheet with no address is enough.
      await page.locator('input[type="file"][accept=".xls,.xlsx"]').setInputFiles({
        name: 'qa-no-emails.xlsx',
        mimeType: 'text/csv',
        buffer: Buffer.from('name\nQA Bench\n', 'utf8'),
      });
      await expect(toast(page, 'No email ids found in Excel'), 'the user is told why').toBeVisible({
        timeout: 10_000,
      });
    });
  },
);
