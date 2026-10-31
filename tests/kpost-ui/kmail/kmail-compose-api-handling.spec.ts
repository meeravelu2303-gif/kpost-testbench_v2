import type { Locator, Page, Route } from '@playwright/test';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { waitLoaded } from '../journeys/support/journey';
import { toast } from '../support/validation';

/**
 * KMail Write Mail (/writemail, WriteMailPage.js PostMail and SaveDraftMail): when the server
 * refuses a mail or a draft, or does not answer, the composer says so. Every /sentMail/postMail and
 * /draft/draftMail call is answered in the browser (the shape each branch reacts to, read from
 * Services/Kmail.js postMailService / SaveDraftMailService), so no mail is sent and no draft is
 * saved.
 */
const POST_MAIL = '**/sentMail/postMail**';
const DRAFT_MAIL = '**/draft/draftMail**';

const json = (body: object) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

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

/** A complete mail to the 2nd QA account (the default "Hi" salutation stays). */
async function writeMail(page: Page, label: string) {
  const form = await openCompose(page);
  await chooseRecipient(page, form.to, testData.victimKpostId);
  await form.subject.fill(`QA api-handling ${label} ${Date.now()}`);
  await form.body.click();
  await page.keyboard.type('QA bench body (answered in the browser, never sent)');
  return form;
}

test.describe(
  'KPost KMail · compose reports a mail or draft the server refuses',
  {
    tag: ['@ui', '@kmail', '@regression'],
    annotation: [{ type: 'non-functional', description: 'resilience' }],
  },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real QA account (QA_KPOST_ID)',
    );
    test.skip(
      !testData.victimKpostId || testData.victimKpostId.includes('qa.victim'),
      'needs the 2nd QA account (QA_VICTIM_KPOST_ID)',
    );

    let answered = 0;

    test.beforeEach(async ({ page }) => {
      answered = 0;
      // Nothing may leave the browser; each test answers the call it fails (registered later, so it wins).
      const block = (route: Route) => {
        answered += 1;
        return route.abort();
      };
      await page.route(POST_MAIL, block);
      await page.route(DRAFT_MAIL, block);
    });

    test('a mail the server could not deliver is reported', async ({ page }) => {
      await page.route(POST_MAIL, (route) => {
        answered += 1;
        return route.fulfill(
          json({
            status: 'SUCCESS',
            statusCode: 200,
            message: '',
            data: [{ mailDeliveryStatus: 'FAILURE' }],
          }),
        );
      });
      const form = await writeMail(page, 'undelivered');
      await form.send.click();
      await expect(toast(page, 'Mail delivery failed'), 'the user is told').toBeVisible({
        timeout: 10_000,
      });
      expect(answered, 'the send was answered in the browser').toBeGreaterThanOrEqual(1);
    });

    test('a mail the server refuses is reported', async ({ page }) => {
      await page.route(POST_MAIL, (route) => {
        answered += 1;
        return route.fulfill(json({ status: 'FAILURE', statusCode: 500, message: '', data: [] }));
      });
      const form = await writeMail(page, 'refused');
      await form.send.click();
      await expect(toast(page, 'Some Error Occurred!'), 'the user is told').toBeVisible({
        timeout: 10_000,
      });
      expect(answered, 'the send was answered in the browser').toBeGreaterThanOrEqual(1);
    });

    test('a mail that gets no answer is reported', async ({ page }) => {
      // The beforeEach abort is the failure: the service returns a FAILURE object with no data.
      const form = await writeMail(page, 'no-answer');
      await form.send.click();
      await expect(toast(page, 'An unexpected error occurred.'), 'the user is told').toBeVisible({
        timeout: 10_000,
      });
      expect(answered, 'the send never left the browser').toBeGreaterThanOrEqual(1);
    });

    test('a draft the server could not save is reported', async ({ page }) => {
      await page.route(DRAFT_MAIL, (route) => {
        answered += 1;
        return route.fulfill(
          json({
            status: 'SUCCESS',
            statusCode: 200,
            message: '',
            data: { mailDeliveryStatus: 'FAILURE' },
          }),
        );
      });
      await writeMail(page, 'draft');
      await page.locator('.icon-KP_95-Write-Mail-Temp').first().click();
      await expect(toast(page, 'Some Error Occured!'), 'the user is told').toBeVisible({
        timeout: 10_000,
      });
      expect(answered, 'the draft was answered in the browser').toBeGreaterThanOrEqual(1);
    });
  },
);
