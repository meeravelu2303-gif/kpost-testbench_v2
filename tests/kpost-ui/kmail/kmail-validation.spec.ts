import type { Locator, Page } from '@playwright/test';
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
      await expect(toast(page, /maximum 70 characters/), 'the user is told the limit').toBeVisible({
        timeout: 10_000,
      });
    });
  },
);
