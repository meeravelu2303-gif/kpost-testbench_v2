import type { Locator, Page } from '@playwright/test';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import {
  createQaGroup,
  deleteQaGroup,
  GROUP_CREATOR,
  groupMenuItem,
  openGroupInfo,
  type QaGroup,
} from '../support/groups';
import {
  EDITOR,
  messageBySubject,
  openBellMenu,
  openComposerFor,
  openConversation,
} from '../support/katchup';
import { toast } from '../support/validation';

/**
 * Katchup conversation (bubble KatchupMessage.js, common/VoiceMessagePlayer, bubble WriteMessage.js):
 * a send, translation, voice transcription or group rename the server fails is reported, and an
 * emoji the composer does not support is refused. The failing call is answered or stopped in the
 * browser, messages are seeded by answering the conversation call, and every message write
 * (send, forward, save, delete, transfer) is stopped at the network, so nothing is ever posted.
 * Voice transcription is hard-coded to devapi2 (the live host): every devapi2 request is answered
 * or stopped in the browser and never leaves it. The group-rename test makes its own group through
 * the API and deletes it afterwards.
 */
const WRITES = /sendMessage|forward|saveKatchup|deleteKatchUpMessage|transfer/i;

const FAILURE = {
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ status: 'FAILURE', statusCode: 500, message: '', data: null }),
};

/** One sent message to the 2nd QA account, in the live thread-fetch shape. */
function seededMessage(subject: string, overrides: Record<string, unknown>) {
  const sent = Date.now();
  return {
    msgID: 999000701,
    sender: testData.kpostId,
    receiver: testData.victimKpostId,
    messageType: 0,
    actualMessage: JSON.stringify([{ insert: 'Good morning, how are you today?\n' }]),
    status: 2,
    deviceID: null,
    sessionID: 'Web-Reactjs',
    attachmentUuid: null,
    attachmentCaptionDetails: null,
    groupFlag: false,
    messageTime: new Date(sent).toISOString(),
    messageTimeAsLong: sent,
    readTime: null,
    readTimeAsLong: 0,
    serverTime: new Date(sent).toISOString(),
    serverTimeAsLong: sent,
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
    ...overrides,
  };
}

/** A made-up voice note: a `_voice` attachment that is never fetched (the stream is stopped). */
const VOICE_UUID = 'qa-bench-voice-0001_voice';
const VOICE = {
  actualMessage: '',
  isVoiceMessage: true,
  attachmentUuid: [VOICE_UUID],
  attachmentCaptionDetails: [{ uuid: VOICE_UUID, fileName: 'qa-bench-voice.wav', caption: '' }],
};

/**
 * Seeds one sent message into the conversation with the 2nd QA account (the voice stream is
 * stopped), opens it and returns the message.
 */
async function openSeeded(
  page: Page,
  label: string,
  overrides: Record<string, unknown> = {},
): Promise<Locator> {
  const subject = `QA ${label} ${Date.now()}`;
  await page.route('**/katchup/mediaStreaming/**', (route) => route.abort());
  await page.route('**/katchup/katchupMessagesForSelectedContactID/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'SUCCESS',
        statusCode: 200,
        lastMsgID: 999000701,
        data: [seededMessage(subject, overrides)],
      }),
    }),
  );
  await openConversation(page, testData.victimKpostId);
  const message = messageBySubject(page, subject);
  await expect(message.first(), 'the seeded message renders (setup)').toBeVisible({
    timeout: 20_000,
  });
  return message;
}

/** Clicks a bell-menu item, through "More" when the menu folds it away. */
async function clickMenuItem(page: Page, name: RegExp): Promise<void> {
  const item = page.getByRole('menuitem', { name }).first();
  if (!(await item.isVisible().catch(() => false)))
    await page
      .getByRole('menuitem', { name: /^More$/i })
      .first()
      .click()
      .catch(() => undefined);
  await item.click();
}

/** The open Translate language list → Tamil. */
async function pickTamil(page: Page): Promise<void> {
  const picker = page
    .getByRole('dialog')
    .filter({ hasText: /Translate/i })
    .last();
  await expect(picker, 'the Translate language list opens').toBeVisible({ timeout: 15_000 });
  await picker.getByPlaceholder(/Search Language/i).fill('Tamil');
  await picker.locator('.language_Font', { hasText: /Tamil/i }).first().click();
}

test.describe(
  'KPost Katchup · a failed send, translation, transcription or group edit is reported',
  {
    tag: ['@ui', '@katchup', '@regression'],
    annotation: [{ type: 'non-functional', description: 'resilience' }],
  },
  () => {
    test.skip(!testData.victimKpostId, 'needs the 2nd QA account (QA_VICTIM_KPOST_ID)');

    // Registered before each test's own routes, so a test's narrower answer takes precedence
    // (Playwright tries the most recently registered route first).
    test.beforeEach(async ({ page }) => {
      await page.route(
        (url) => WRITES.test(url.pathname),
        (route) => route.abort(),
      );
      await page.route(
        (url) => url.hostname === 'devapi2.kpostindia.com',
        (route) => route.abort(),
      );
    });

    test('a message the server does not answer is reported', async ({ page }) => {
      let sends = 0;
      await page.route('**/katchup/sendMessage/**', (route) => {
        sends += 1;
        return route.abort();
      });
      await openComposerFor(page, testData.victimKpostId);
      await page.getByRole('textbox', { name: 'Subject' }).fill(`QA send-fail ${Date.now()}`);
      await page.locator(EDITOR).first().click();
      await page.keyboard.type('QA bench: this message is stopped in the browser.');
      await page.keyboard.press('Enter');
      await expect(
        toast(page, 'Some Error Occured!, Please Try Again!'),
        'the user is told the message was not sent',
      ).toBeVisible({ timeout: 10_000 });
      expect(sends, 'the send was tried (and stopped in the browser)').toBe(1);
    });

    test('a translation the server refuses is reported', async ({ page }) => {
      let translations = 0;
      await page.route('**/translator/translation/**', (route) => {
        translations += 1;
        return route.fulfill(FAILURE);
      });
      const message = await openSeeded(page, 'translate-fail');
      await message.scrollIntoViewIfNeeded().catch(() => undefined);
      await message.hover().catch(() => undefined);
      await message.locator('.icon-KP_75-translate').first().click();
      await pickTamil(page);
      await expect(
        toast(page, 'Error Occured While Translating'),
        'the user is told the translation failed',
      ).toBeVisible({ timeout: 10_000 });
      expect(translations, 'the translation was asked for').toBe(1);
    });

    test('a voice transcription the server does not answer is reported', async ({ page }) => {
      let transcriptions = 0;
      await page.route('**/voice/translate**', (route) => {
        transcriptions += 1;
        return route.abort();
      });
      const message = await openSeeded(page, 'transcribe-fail', { msgID: 999000702, ...VOICE });
      await openBellMenu(page, message);
      await clickMenuItem(page, /Voice Transcription/i);
      await expect(
        toast(page, 'Voice transcription failed'),
        'the user is told the transcription failed',
      ).toBeVisible({ timeout: 10_000 });
      expect(transcriptions, 'the transcription was tried (and stopped in the browser)').toBe(1);
    });

    test("a voice note's transcript translation the server refuses is reported", async ({
      page,
    }) => {
      // The transcript is answered in the browser, so the player offers its Translate button.
      await page.route('**/voice/translate**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'text/plain',
          body: 'Good morning, how are you today?',
        }),
      );
      let translations = 0;
      await page.route('**/translator/translation/**', (route) => {
        translations += 1;
        return route.fulfill(FAILURE);
      });
      const message = await openSeeded(page, 'voice-translate-fail', {
        msgID: 999000703,
        ...VOICE,
      });
      await message.scrollIntoViewIfNeeded().catch(() => undefined);
      await message.locator('button.voiceMoreBtn').first().click();
      const transcript = message.locator('.transcriptCard').first();
      await expect(transcript, 'the transcript opens').toBeVisible({ timeout: 15_000 });
      await transcript.locator('button[title="Translate"]').first().click();
      await pickTamil(page);
      await expect(
        toast(page, 'Error Occured While Translating'),
        'the user is told the translation failed',
      ).toBeVisible({ timeout: 10_000 });
      expect(translations, 'the translation was asked for').toBe(1);
    });

    test('a group rename the server refuses is reported', async ({ page, endpoints }) => {
      test.skip(!GROUP_CREATOR, 'needs provisioned qatest3 (the group creator)');
      let renames = 0;
      await page.route('**/group/editGroupName**', (route) => {
        renames += 1;
        return route.fulfill(FAILURE);
      });
      let group: QaGroup | undefined;
      try {
        // qatest3 makes the group with the browser's account as an admin, so it may edit it.
        group = await createQaGroup(endpoints, 'rename-fail', { admins: [testData.kpostId] });
        const panel = await openGroupInfo(page, group);
        await groupMenuItem(page, panel, 'Edit Group');
        const edit = page.locator('.modal-dialog', { hasText: 'Edit Group' }).last();
        await edit.getByLabel('Group Name').fill(`QA renamed ${Date.now()}`);
        await edit.getByRole('button', { name: 'Change' }).first().click();
        await expect(
          toast(page, 'Some Error Occured!'),
          'the user is told the group was not renamed',
        ).toBeVisible({ timeout: 10_000 });
        expect(renames, 'the rename was tried (and answered in the browser)').toBe(1);
      } finally {
        await deleteQaGroup(endpoints, group);
      }
    });

    test('an emoji the composer does not support is refused', async ({ page }) => {
      await openComposerFor(page, testData.victimKpostId);
      await page.locator('[title="Emoji"]').filter({ visible: true }).first().click();
      const picker = page.locator('.EmojiPickerReact').filter({ visible: true }).first();
      await expect(picker, 'the emoji picker opens').toBeVisible({ timeout: 10_000 });
      // U+1FAE0 "melting face" (Emoji 14.0) is on WriteMessage.js's block-list; emoji-picker-react
      // offers it near the top of Smileys & People.
      await picker.locator('button[data-unified="1fae0"]').first().click();
      await expect(
        toast(page, 'This emoji is not available'),
        'the user is told the emoji is not available',
      ).toBeVisible({ timeout: 10_000 });
      await expect(page.locator(EDITOR).first(), 'the emoji is not inserted').not.toContainText(
        '\u{1FAE0}',
      );
    });
  },
);
