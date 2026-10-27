import type { Page } from '@playwright/test';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import {
  messageBySubject,
  openBellMenu,
  openComposerFor,
  openConversation,
} from '../support/katchup';
import { settleFrames } from '../support/settle';

/**
 * Katchup per-message features: Voice Transcription, Print, Mark important (success and failure) and
 * voice recording. A stubbed sent message and stubbed backend calls mean nothing is written.
 */

/** One realistic thread message (shape mirrors the live thread-fetch; msgID 999000301). */
function seedMessage(
  subject: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const sent = Date.now();
  return {
    msgID: 999000301,
    sender: testData.kpostId,
    receiver: testData.victimKpostId,
    messageType: 0,
    actualMessage: JSON.stringify([{ insert: `${subject}\n` }]),
    status: 2,
    deviceID: null,
    sessionID: 'Web-Reactjs',
    attachmentUuid: null,
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
    attachmentCaptionDetails: null,
    temporaryMsgID: 0,
    contactDetails: null,
    ...overrides,
  };
}

async function seedThread(
  page: Page,
  subject: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await page.route('**/katchup/katchupMessagesForSelectedContactID/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'SUCCESS',
        statusCode: 200,
        lastMsgID: 999000301,
        data: [seedMessage(subject, overrides)],
      }),
    }),
  );
}

const errorSignal =
  '.Toastify__toast--error, .Toastify__toast, [role="alert"], [class*="error" i], [class*="danger" i]';

test.describe(
  'KPost Katchup · feature integrity',
  { tag: ['@ui', '@katchup', '@regression'] },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench') || !testData.victimKpostId,
      'needs both QA accounts',
    );

    test('Voice Transcription reaches the voice/translate service (devapi2 is the voice host by design) @ui', async ({
      page,
    }) => {
      let translateUrl = '';
      await page.route('**/voice/translate**', (route) => {
        translateUrl = route.request().url();
        return route.fulfill({ status: 200, contentType: 'text/plain', body: 'QA transcript' });
      });

      const subject = `QA voice-xcribe ${Date.now()}`;
      // attachmentUuid present so the handler proceeds to the fetch (not "No voice file found").
      await seedThread(page, subject, {
        msgID: 999000401,
        attachmentUuid: ['qa-voice-uuid-0001'],
        isVoiceMessage: true,
      });

      await openConversation(page, testData.victimKpostId);
      await settleFrames(page);

      const message = messageBySubject(page, subject);
      expect(
        await message
          .first()
          .waitFor({ state: 'visible', timeout: 10_000 })
          .then(() => true)
          .catch(() => false),
        'the seeded voice message must render so Voice Transcription can be exercised',
      ).toBe(true);

      await openBellMenu(page, message);
      await revealAndClickMenuItem(page, /Voice Transcription/i);
      await settleFrames(page);

      expect(translateUrl, 'the Voice Transcription request must have fired').not.toBe('');
      test.info().annotations.push({
        type: 'observed',
        description: `voice transcription requested: ${translateUrl}`,
      });
      // The voice service lives on devapi2 by design, so only the endpoint is checked, not the host.
      expect(
        /\/voice\/translate/i.test(translateUrl),
        `Voice Transcription must reach the voice/translate service (saw: ${translateUrl})`,
      ).toBe(true);
    });

    test('Print opens the print preview and drives the browser print dialog @ui', async ({
      page,
    }) => {
      await page.addInitScript(() => {
        (window as unknown as { __printCalled?: boolean }).__printCalled = false;
        window.print = () => {
          (window as unknown as { __printCalled?: boolean }).__printCalled = true;
        };
      });

      const subject = `QA print ${Date.now()}`;
      await seedThread(page, subject, { msgID: 999000501 });

      await openConversation(page, testData.victimKpostId);
      await settleFrames(page);

      const message = messageBySubject(page, subject);
      await message.first().waitFor({ state: 'visible', timeout: 10_000 });
      await openBellMenu(page, message);
      await revealAndClickMenuItem(page, /^Print$/i);

      await expect(page.locator('#print-section'), 'the print preview opens').toBeVisible({
        timeout: 8_000,
      });
      await page.getByRole('button', { name: /Print Letter/i }).click();
      const printed = await page.evaluate(
        () => (window as unknown as { __printCalled?: boolean }).__printCalled === true,
      );
      test
        .info()
        .annotations.push({ type: 'observed', description: `window.print called: ${printed}` });
      expect(printed, 'clicking "Print Letter" must invoke the browser print dialog').toBe(true);
    });

    test('Mark as important toggles and shows a success confirmation @ui', async ({ page }) => {
      await page.route('**/katchup/markOrUnmarkImportantMessage/**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'SUCCESS', statusCode: 200, message: 'marked' }),
        }),
      );

      const subject = `QA star-ok ${Date.now()}`;
      await seedThread(page, subject, { msgID: 999000601, isMarked: false });

      await openConversation(page, testData.victimKpostId);
      await settleFrames(page);

      const star = messageBySubject(page, subject).locator('div.icon-KP_43-Fav').first();
      await star.scrollIntoViewIfNeeded().catch(() => undefined);
      await star.click({ force: true });

      const shown = await page
        .locator('.Toastify__toast', { hasText: /marked as (important|unimportant)/i })
        .first()
        .waitFor({ state: 'visible', timeout: 8_000 })
        .then(() => true)
        .catch(() => false);
      expect(shown, 'marking a message important must show a confirmation').toBe(true);
    });

    test('Mark as important surfaces an error when the server rejects it @ui', async ({ page }) => {
      await page.route('**/katchup/markOrUnmarkImportantMessage/**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'FAILURE', statusCode: 400, message: 'nope' }),
        }),
      );

      const subject = `QA star-fail ${Date.now()}`;
      await seedThread(page, subject, { msgID: 999000701, isMarked: false });

      await openConversation(page, testData.victimKpostId);
      await settleFrames(page);

      const star = messageBySubject(page, subject).locator('div.icon-KP_43-Fav').first();
      await star.scrollIntoViewIfNeeded().catch(() => undefined);
      await star.click({ force: true });

      const shown = await page
        .locator(errorSignal, { hasText: /unable to marked|error|fail|unable/i })
        .first()
        .waitFor({ state: 'visible', timeout: 8_000 })
        .then(() => true)
        .catch(() => false);
      expect(shown, 'a rejected mark must surface an error (the handler has an else branch)').toBe(
        true,
      );
    });

    test('the composer mic starts a voice recording and shows the stop/attach controls @ui', async ({
      page,
    }) => {
      // Mock the mic + MediaRecorder so the record flow runs headless (no real audio device).
      await page.addInitScript(() => {
        const fakeStream = { getTracks: () => [{ stop() {} }] } as unknown as MediaStream;
        if (!navigator.mediaDevices) {
          Object.defineProperty(navigator, 'mediaDevices', { value: {}, configurable: true });
        }
        (navigator.mediaDevices as unknown as { getUserMedia: unknown }).getUserMedia = () =>
          Promise.resolve(fakeStream);
        class FakeRecorder {
          state = 'inactive';
          ondataavailable: ((e: { data: Blob }) => void) | null = null;
          onstop: (() => void) | null = null;
          start(): void {
            this.state = 'recording';
          }
          stop(): void {
            this.state = 'inactive';
            this.ondataavailable?.({ data: new Blob(['x'], { type: 'audio/webm' }) });
            this.onstop?.();
          }
          pause(): void {}
          resume(): void {}
          static isTypeSupported(): boolean {
            return true;
          }
        }
        (window as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeRecorder;
      });

      await openComposerFor(page, testData.victimKpostId);
      await settleFrames(page);

      const mic = page.locator('div.mic-wrapper[data-tooltip="Voice note"]').first();
      await expect(mic, 'the composer mic button is present').toBeVisible({ timeout: 10_000 });
      await mic.click();

      const stop = page.getByRole('button', { name: /Stop Recording/i });
      const recording = await stop
        .first()
        .waitFor({ state: 'visible', timeout: 8_000 })
        .then(() => true)
        .catch(() => false);
      test
        .info()
        .annotations.push({ type: 'observed', description: `recording UI shown: ${recording}` });
      expect(recording, 'clicking the mic must start a recording (stop control appears)').toBe(
        true,
      );

      await stop.first().click();
      const attach = await page
        .getByRole('button', { name: /Attach recording|Delete Recording|Play Recording/i })
        .first()
        .waitFor({ state: 'visible', timeout: 8_000 })
        .then(() => true)
        .catch(() => false);
      expect(attach, 'stopping the recording must show the preview/attach controls').toBe(true);
    });
  },
);

/** Open an action already shown in the menu, or reveal it via the "More" item first (menus slice to 5). */
async function revealAndClickMenuItem(page: Page, name: RegExp): Promise<void> {
  const item = page.getByRole('menuitem', { name });
  if (
    !(await item
      .first()
      .isVisible()
      .catch(() => false))
  ) {
    await page
      .getByRole('menuitem', { name: /^More$/i })
      .first()
      .click()
      .catch(() => undefined);
  }
  await item.first().click();
}
