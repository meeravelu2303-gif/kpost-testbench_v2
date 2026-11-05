import type { Locator, Page } from '@playwright/test';
import { testData } from '@config/test-data.config';
import { healthFailures, isResponsive, watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';
import { waitLoaded } from '../journeys/support/journey';

/**
 * KMail under a bad network: a slow inbox load still finishes (no stuck splash), a double click on
 * Send sends one mail, going offline at Send keeps the mail and a send works once back online, and
 * a reload while a send is out brings Write Mail back. Selectors as kmail-compose-api-handling
 * (WriteMailPage.js). Every /sentMail/postMail and /draft/draftMail call is answered in the browser,
 * so no mail is sent and no draft is saved.
 */
const INBOX = '**/common/getKmailDashboardMsg/**';
const POST_MAIL = '**/sentMail/postMail**';
const DRAFT_MAIL = '**/draft/draftMail**';
const BOUNDARY = /Something went wrong/i;
const REFUSAL = {
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ status: 'FAILURE', statusCode: 500, message: '', data: [] }),
};
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function openCompose(page: Page) {
  await page.goto('/writemail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await waitLoaded(page);
  const subject = page.locator('.toInput').first();
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

async function chooseRecipient(page: Page, to: Locator, address: string) {
  await to.click();
  await to.fill(address);
  await page
    .locator('.suggestion-dropdown')
    .getByText(address, { exact: false })
    .first()
    .click({ timeout: 4_000 })
    .catch(() => to.press('Enter'));
  await page.keyboard.press('Escape');
}

/** A complete mail to the 2nd QA account; returns the form and the subject typed. */
async function writeMail(page: Page, label: string) {
  const form = await openCompose(page);
  const subject = `QA resilience ${label} ${Date.now()}`;
  await chooseRecipient(page, form.to, testData.victimKpostId);
  await form.subject.fill(subject);
  await form.body.click();
  await page.keyboard.type('QA bench body (answered in the browser, never sent)');
  return { ...form, subjectText: subject };
}

test.describe(
  'KPost KMail · inbox and compose under a slow or lost network',
  {
    tag: ['@ui', '@kmail', '@regression'],
    annotation: [{ type: 'non-functional', description: 'resilience' }],
  },
  () => {
    test.describe.configure({ timeout: 180_000 });
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real QA account (QA_KPOST_ID)',
    );

    test.beforeEach(async ({ page }) => {
      // Nothing may leave the browser; tests that send register their own answer later (it wins).
      await page.route(POST_MAIL, (route) => route.fulfill(REFUSAL));
      await page.route(DRAFT_MAIL, (route) => route.fulfill(REFUSAL));
    });

    test('a slow inbox load still finishes, with no stuck loading state @ui', async ({ page }) => {
      await page.route(INBOX, async (route) => {
        await delay(6_000);
        await route.continue().catch(() => undefined);
      });
      const answered = page.waitForResponse(
        (r) => r.url().includes('/common/getKmailDashboardMsg'),
        {
          timeout: 60_000,
        },
      );
      await page.goto('/kmail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await answered;
      await expect(page.locator('.loader-overlay'), 'the loading splash goes away').toBeHidden({
        timeout: 20_000,
      });
      await expect(
        page.locator('.kmail-layout-shell, .Serach_input').first(),
        'the KMail screen renders once the slow inbox answers',
      ).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(BOUNDARY), 'no error boundary').toHaveCount(0);
    });

    test('a double click on Send sends one mail @ui', async ({ page }) => {
      test.skip(
        !testData.victimKpostId || testData.victimKpostId.includes('qa.victim'),
        'needs the 2nd QA account (QA_VICTIM_KPOST_ID)',
      );
      let calls = 0;
      await page.route(POST_MAIL, async (route) => {
        calls += 1;
        await delay(3_000);
        await route.fulfill(REFUSAL).catch(() => undefined);
      });
      const form = await writeMail(page, 'double-send');
      const answered = page.waitForResponse((r) => r.url().includes('/sentMail/postMail'), {
        timeout: 20_000,
      });
      await form.send.dblclick();
      await answered;
      test.info().annotations.push({ type: 'observed', description: `send requests: ${calls}` });
      expect(calls, 'one double click must send one mail, not two').toBe(1);
    });

    test('going offline at Send keeps the mail, and Send works once back online @ui', async ({
      page,
      context,
    }) => {
      test.skip(
        !testData.victimKpostId || testData.victimKpostId.includes('qa.victim'),
        'needs the 2nd QA account (QA_VICTIM_KPOST_ID)',
      );
      let calls = 0;
      await page.route(POST_MAIL, (route) => {
        calls += 1;
        return route.fulfill(REFUSAL);
      });
      const form = await writeMail(page, 'offline');
      const stop = watchUiHealth(page);
      await context.setOffline(true);
      try {
        await form.send.click();
        await expect(page.getByText(BOUNDARY), 'no error boundary while offline').toHaveCount(0);
        expect(await isResponsive(page), 'the composer does not freeze offline').toBe(true);
        await expect(form.subject, 'the mail is kept, not thrown away').toHaveValue(
          form.subjectText,
        );
      } finally {
        await context.setOffline(false);
      }
      const before = calls;
      await form.send.click();
      await expect
        .poll(() => calls, { message: 'a send once back online reaches the network' })
        .toBeGreaterThan(before);
      expect(healthFailures(stop()), 'no crash across offline and back').toEqual([]);
    });

    test('a reload while a send is out brings Write Mail back @ui', async ({ page }) => {
      test.skip(
        !testData.victimKpostId || testData.victimKpostId.includes('qa.victim'),
        'needs the 2nd QA account (QA_VICTIM_KPOST_ID)',
      );
      let calls = 0;
      await page.route(POST_MAIL, async (route) => {
        calls += 1;
        await delay(20_000);
        await route.fulfill(REFUSAL).catch(() => undefined);
      });
      const form = await writeMail(page, 'reload');
      await form.send.click();
      await expect.poll(() => calls, { message: 'the send request fired' }).toBeGreaterThan(0);
      const stop = watchUiHealth(page);
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 });
      const again = await openCompose(page);
      await expect(again.subject, 'Write Mail is usable again').toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(BOUNDARY), 'no error boundary after the reload').toHaveCount(0);
      test.info().annotations.push({
        type: 'observed',
        description: `send requests across the reload: ${calls}`,
      });
      expect(stop().pageErrors, 'no uncaught error after the reload').toEqual([]);
    });
  },
);
