import type { Page } from '@playwright/test';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { messageBySubject, openBellMenu, openConversation } from '../support/katchup';
import { toast } from '../support/validation';

/**
 * A sent Katchup message with two attachments and no text (bubble KatchupMessage.js,
 * forwardFooter/ForwardFooter.js): Copy and Text-To-Speech have no text to use, a forward of
 * "All Attachments" needs the message ticked, and a forward "Without Attachments" of a message with
 * no text has nothing to send. The message is seeded by answering the conversation call, and every
 * write (send, forward, save, delete) is stopped at the network, so nothing changes.
 */
const WRITES = /sendMessage|forward|saveKatchup|deleteKatchUpMessage|transfer/i;

/** Seeds one sent message to the 2nd QA account: no text, two attachments. */
async function seedAttachmentOnlyMessage(page: Page, subject: string): Promise<void> {
  const sent = Date.now();
  await page.route('**/katchup/katchupMessagesForSelectedContactID/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'SUCCESS',
        statusCode: 200,
        lastMsgID: 999000101,
        data: [
          {
            msgID: 999000101,
            sender: testData.kpostId,
            receiver: testData.victimKpostId,
            messageType: 0,
            actualMessage: '',
            status: 2,
            sessionID: 'Web-Reactjs',
            attachmentUuid: ['qa-bench-attachment-1', 'qa-bench-attachment-2'],
            attachmentCaptionDetails: null,
            groupFlag: false,
            messageTime: new Date(sent).toISOString(),
            messageTimeAsLong: sent,
            serverTime: new Date(sent).toISOString(),
            serverTimeAsLong: sent,
            readTime: null,
            readTimeAsLong: 0,
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
            sharedMessageId: sent,
            senderName: 'QA Tester',
            receiverName: 'QA Victim',
            sharedType: 0,
            isCopyMessage: false,
            isHtml: false,
            referenceMessageIDList: [],
            isVoiceMessage: false,
            temporaryMsgID: 0,
            contactDetails: null,
          },
        ],
      }),
    }),
  );
}

async function openSeeded(page: Page): Promise<string> {
  const subject = `QA attachments only ${Date.now()}`;
  let writes = 0;
  await page.route(
    (url) => WRITES.test(url.pathname),
    (route) => {
      writes += 1;
      return route.abort();
    },
  );
  await seedAttachmentOnlyMessage(page, subject);
  await openConversation(page, testData.victimKpostId);
  const message = messageBySubject(page, subject);
  await expect(message.first(), 'the seeded message renders (setup)').toBeVisible({
    timeout: 20_000,
  });
  await openBellMenu(page, message);
  test.info().annotations.push({ type: 'writes-blocked', description: String(writes) });
  return subject;
}

const menuItem = (page: Page, name: string) =>
  page.getByRole('menuitem', { name: new RegExp(`\\b${name}$`, 'i') }).last();

test.describe(
  'KPost Katchup · a message with attachments and no text',
  { tag: ['@ui', '@katchup', '@regression'] },
  () => {
    test.skip(!testData.victimKpostId, 'needs the 2nd QA account (QA_VICTIM_KPOST_ID)');

    test('Copy says there is no text to copy', async ({ page }) => {
      await openSeeded(page);
      await menuItem(page, 'Copy').click();
      await expect(toast(page, 'No text to copy.'), 'the user is told why').toBeVisible({
        timeout: 10_000,
      });
    });

    test('Text-To-Speech says there is no readable text', async ({ page }) => {
      await openSeeded(page);
      await menuItem(page, 'Text-To-Speech').click();
      await expect(toast(page, 'No readable text available'), 'the user is told why').toBeVisible({
        timeout: 10_000,
      });
    });

    test('forwarding "All Attachments" with the message unticked is refused', async ({ page }) => {
      await openSeeded(page);
      await menuItem(page, 'Forward').click();
      // Two attachments: the forward asks what to send. Untick the message first.
      const all = page.getByText(/^All Attachments$/).first();
      await expect(all, 'the attachment choices appear').toBeVisible({ timeout: 10_000 });
      await page.locator('.message-select-box input[type="checkbox"]:checked').first().uncheck();
      await all.click();
      await expect(
        toast(page, 'Please select at least one message'),
        'the user is told to tick the message',
      ).toBeVisible({ timeout: 10_000 });
    });

    test('a forward can go to at most five groups', async ({ page }) => {
      await openSeeded(page);
      await menuItem(page, 'Forward').click();
      await page
        .getByText(/^All Attachments$/)
        .first()
        .click({ timeout: 10_000 });
      await page.locator('.forwardtextto').first().click({ timeout: 10_000 });
      const picker = page
        .getByRole('dialog')
        .filter({ hasText: /Forward To/i })
        .last();
      await expect(picker, 'the recipient picker opens').toBeVisible({ timeout: 10_000 });
      // The open conversation's contact is left out, so every row below Select All is a group.
      const boxes = picker.locator('input[type="checkbox"]');
      const groups = (await boxes.count()) - 1;
      test.skip(groups < 6, 'needs provisioned membership of at least six groups');
      for (let i = 1; i <= 6; i += 1)
        await boxes
          .nth(i)
          .check({ timeout: 5_000 })
          .catch(() => undefined);
      await expect(
        toast(page, 'You can only Forward with up to 50 contacts and 5 groups'),
        'the sixth group is refused with the limit',
      ).toBeVisible({ timeout: 10_000 });
    });

    test('forwarding a text-less message "Without Attachments" is refused', async ({ page }) => {
      await openSeeded(page);
      await menuItem(page, 'Forward').click();
      await page
        .getByText(/^Without Attachments$/)
        .first()
        .click({ timeout: 10_000 });
      await page.locator('.forwardtextto').first().click({ timeout: 10_000 });
      const picker = page
        .getByRole('dialog')
        .filter({ hasText: /Forward To/i })
        .last();
      await expect(picker, 'the recipient picker opens').toBeVisible({ timeout: 10_000 });
      // The picker leaves out the open conversation's contact, so a group is the recipient (the
      // forward is blocked at the network either way). The first checkbox is the list's Select All.
      const groupBox = picker.locator('input[type="checkbox"]').nth(1);
      await expect(groupBox, 'a recipient group is offered (setup)').toBeVisible({
        timeout: 10_000,
      });
      await groupBox.check();
      await picker
        .getByRole('button', { name: /^Done$/i })
        .first()
        .click();
      await page.locator('button.post_button_size').last().click();
      await expect(
        toast(page, 'Empty Message and Without Attachment Cannot be Forwarded !'),
        'the user is told there is nothing to forward',
      ).toBeVisible({ timeout: 10_000 });
    });
  },
);
