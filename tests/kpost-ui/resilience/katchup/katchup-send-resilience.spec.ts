import type { Page } from '@playwright/test';
import { testData } from '@config/test-data.config';
import { healthFailures, isResponsive, watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';
import { EDITOR, openComposerFor, openConversation } from '../../support/katchup';

/**
 * Katchup under a bad network: a slow thread load still renders its messages, a double Enter sends
 * one message, going offline at Send does not crash the composer and a send works once back online,
 * and a reload while a send is out brings the conversation back. Send (POST /katchup/sendMessage/,
 * bubble/KatchupMessage/KatchupMessage.js) is always answered in the browser, so nothing is sent.
 */
const THREAD = '**/katchup/katchupMessagesForSelectedContactID/**';
const SEND = '**/katchup/sendMessage/**';
const BOUNDARY = /Something went wrong/i;
const REFUSAL = {
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ status: 'FAILURE', statusCode: 400, message: 'QA bench refusal' }),
};
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** One received message in the thread response's shape (as katchup-api-handling seeds it). */
function threadWith(subject: string): string {
  const at = Date.now();
  return JSON.stringify({
    status: 'SUCCESS',
    statusCode: 200,
    lastMsgID: 999000101,
    data: [
      {
        msgID: 999000101,
        sender: testData.victimKpostId,
        receiver: testData.kpostId,
        messageType: 0,
        actualMessage: JSON.stringify([{ insert: `${subject}\n` }]),
        status: 0,
        deviceID: null,
        sessionID: 'Web-Reactjs',
        attachmentUuid: null,
        groupFlag: false,
        messageTime: new Date(at).toISOString(),
        messageTimeAsLong: at,
        readTime: null,
        readTimeAsLong: 0,
        serverTime: new Date(at).toISOString(),
        serverTimeAsLong: at,
        subject,
        isDeleted: false,
        isMarked: false,
        referenceMessage: null,
        referenceMessageList: null,
        secretMessageExpireTime: null,
        secretMessageExpireTimeAsLong: 0,
        selectedMembers: 'N',
        isBlockedContact: false,
        isVanished: false,
        sharedMessageDetails: null,
        sharedMessageId: at,
        senderName: 'QA Victim',
        receiverName: 'QA Tester',
        sharedType: 0,
        isCopyMessage: false,
        isHtml: false,
        referenceMessageIDList: [],
        isVoiceMessage: false,
        attachmentCaptionDetails: null,
        temporaryMsgID: 0,
        contactDetails: null,
      },
    ],
  });
}

/** Subject + body in the open composer (Quill: typed, never filled). */
async function writeMessage(page: Page, label: string): Promise<void> {
  await page.getByRole('textbox', { name: 'Subject' }).fill(`QA resilience ${label} ${Date.now()}`);
  await page.locator(EDITOR).first().click();
  await page.keyboard.type('QA bench resilience probe (answered in the browser, never sent)');
}

test.describe(
  'KPost Katchup · thread and send under a slow or lost network',
  {
    tag: ['@ui', '@katchup', '@regression'],
    annotation: [{ type: 'non-functional', description: 'resilience' }],
  },
  () => {
    test.describe.configure({ timeout: 180_000 });
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench') || !testData.victimKpostId,
      'needs both QA accounts',
    );

    test('a slow thread load still shows its messages when it arrives @ui', async ({ page }) => {
      const subject = `QA slow thread ${Date.now()}`;
      await page.route(THREAD, async (route) => {
        await delay(6_000);
        await route
          .fulfill({ status: 200, contentType: 'application/json', body: threadWith(subject) })
          .catch(() => undefined);
      });
      await openConversation(page, testData.victimKpostId);
      await expect(
        page.getByText(subject).first(),
        'the message shows once the slow thread load answers (no stuck loading state)',
      ).toBeVisible({ timeout: 45_000 });
      await expect(page.getByText(BOUNDARY), 'no error boundary').toHaveCount(0);
    });

    test('pressing Enter twice quickly sends one message @ui', async ({ page }) => {
      let calls = 0;
      await page.route(SEND, async (route) => {
        calls += 1;
        await delay(3_000);
        await route.fulfill(REFUSAL).catch(() => undefined);
      });
      await openComposerFor(page, testData.victimKpostId);
      await writeMessage(page, 'double-send');
      const answered = page.waitForResponse((r) => r.url().includes('/katchup/sendMessage'), {
        timeout: 20_000,
      });
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      await answered;
      test.info().annotations.push({ type: 'observed', description: `send requests: ${calls}` });
      expect(calls, 'one message typed once must be sent once').toBe(1);
    });

    test('going offline at Send does not crash the composer, and a send works once back online @ui', async ({
      page,
      context,
    }) => {
      let calls = 0;
      await page.route(SEND, (route) => {
        calls += 1;
        return route.fulfill(REFUSAL);
      });
      await openComposerFor(page, testData.victimKpostId);
      await writeMessage(page, 'offline');
      const stop = watchUiHealth(page);
      await context.setOffline(true);
      try {
        await page.keyboard.press('Enter');
        await expect(page.getByText(BOUNDARY), 'no error boundary while offline').toHaveCount(0);
        expect(await isResponsive(page), 'the composer does not freeze offline').toBe(true);
      } finally {
        await context.setOffline(false);
      }
      const before = calls;
      // The composer may have kept or cleared the text; write again and send once online.
      const composer = page.locator(EDITOR).first();
      if (!(await composer.isVisible().catch(() => false))) {
        await page.locator('.msg-arrow').first().click();
      }
      await writeMessage(page, 'back-online');
      await page.keyboard.press('Enter');
      await expect
        .poll(() => calls, { message: 'a send once back online reaches the network' })
        .toBeGreaterThan(before);
      expect(healthFailures(stop()), 'no crash across offline and back').toEqual([]);
    });

    test('a reload while a send is out brings the conversation back @ui', async ({ page }) => {
      let calls = 0;
      await page.route(SEND, async (route) => {
        calls += 1;
        await delay(20_000);
        await route.fulfill(REFUSAL).catch(() => undefined);
      });
      await openComposerFor(page, testData.victimKpostId);
      await writeMessage(page, 'reload');
      await page.keyboard.press('Enter');
      await expect.poll(() => calls, { message: 'the send request fired' }).toBeGreaterThan(0);
      const stop = watchUiHealth(page);
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 });
      await openComposerFor(page, testData.victimKpostId);
      await expect(page.locator(EDITOR).first(), 'the composer is usable again').toBeVisible({
        timeout: 20_000,
      });
      await expect(page.getByText(BOUNDARY), 'no error boundary after the reload').toHaveCount(0);
      test.info().annotations.push({
        type: 'observed',
        description: `send requests across the reload: ${calls}`,
      });
      expect(stop().pageErrors, 'no uncaught error after the reload').toEqual([]);
    });
  },
);
