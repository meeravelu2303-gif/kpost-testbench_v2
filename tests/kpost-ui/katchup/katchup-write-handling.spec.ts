import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import {
  EDITOR,
  messageBySubject,
  openBellMenu,
  openComposerFor,
  openConversation,
} from '../support/katchup';
import { settleFrames } from '../support/settle';

/**
 * Katchup Send, Delete and Save must tell the user when the server answers with a FAILURE envelope.
 * The write call is stubbed (no real write), so these need no KATCHUP_UI_LIFECYCLE.
 */
test.describe(
  'KPost Katchup · write-action failure feedback',
  {
    tag: ['@ui', '@katchup', '@regression'],
    annotation: [{ type: 'non-functional', description: 'resilience' }],
  },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench') || !testData.victimKpostId,
      'needs both QA accounts',
    );

    /** Any visible error signal: a toast, an alert, or inline error text. */
    const errorSignal =
      '.Toastify__toast--error, .Toastify__toast, [role="alert"], [class*="error" i], [class*="danger" i]';

    const FAILURE = {
      status: 200 as const,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'FAILURE',
        statusCode: 400,
        message: 'Message could not be sent',
        data: 'Message could not be sent',
      }),
    };

    test('a send that the server REJECTS (FAILURE envelope) must tell the user, not vanish silently @ui', async ({
      page,
    }) => {
      await page.route('**/katchup/sendMessage/**', (route) => route.fulfill(FAILURE));

      await openComposerFor(page, testData.victimKpostId);

      const subject = `QA send-fail ${Date.now()}`;
      await page.getByRole('textbox', { name: 'Subject' }).fill(subject);
      await page.locator(EDITOR).first().click();
      await page.keyboard.type('QA send-failure feedback probe');
      await page.keyboard.press('Enter');

      const shown = await page
        .locator(errorSignal, {
          hasText: /error|fail|could not|unable|not sent|try again|went wrong/i,
        })
        .first()
        .waitFor({ state: 'visible', timeout: 8_000 })
        .then(() => true)
        .catch(() => false);

      test.info().annotations.push({
        type: 'observed',
        description: shown
          ? 'error shown on rejected send'
          : 'send was rejected (FAILURE) with NO visible feedback — message vanished silently',
      });
      expect(
        shown,
        'a send the server rejects must surface an error — otherwise the message silently disappears and ' +
          'the user believes it was delivered',
      ).toBe(true);
    });

    test('a delete that the server REJECTS (FAILURE envelope) must tell the user, not leave the message as if gone @ui', async ({
      page,
    }) => {
      const subject = `QA delete-fail ${Date.now()}`;
      const sent = Date.now();
      // Seed a SENT message (sender = me) so the thread shows a bell (sender) action menu to delete.
      await page.route('**/katchup/katchupMessagesForSelectedContactID/**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 'SUCCESS',
            statusCode: 200,
            lastMsgID: 999000001,
            data: [
              {
                msgID: 999000001,
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
              },
            ],
          }),
        }),
      );
      // Track that the delete fired, so a selector miss cannot pass for the silent-failure bug.
      let deleteCalled = false;
      await page.route('**/katchup/deleteKatchUpMessage/**', (route) => {
        deleteCalled = true;
        return route.fulfill(FAILURE);
      });

      await openConversation(page, testData.victimKpostId);
      await settleFrames(page);

      const message = messageBySubject(page, subject);
      const seeded = await message
        .first()
        .waitFor({ state: 'visible', timeout: 10_000 })
        .then(() => true)
        .catch(() => false);
      // Guard against a false pass: if the seeded message never rendered, the delete flow was not exercised.
      expect(
        seeded,
        'the seeded sent message must render so the delete action can be exercised',
      ).toBe(true);

      await openBellMenu(page, message);
      await page
        .getByRole('menuitem', { name: /Delete/i })
        .click()
        .catch(() => undefined);
      await page
        .getByRole('button', { name: /^Confirm$/i })
        .click()
        .catch(() => undefined);
      await settleFrames(page);

      const errorShown = await page
        .locator(errorSignal, { hasText: /error|fail|could not|unable|try again|went wrong/i })
        .first()
        .isVisible()
        .catch(() => false);
      const stillThere = await messageBySubject(page, subject)
        .first()
        .isVisible()
        .catch(() => false);

      expect(
        deleteCalled,
        'the delete request must have fired (bell → Delete → Confirm) to exercise the flow',
      ).toBe(true);

      test.info().annotations.push({
        type: 'observed',
        description: `after a rejected delete — delete fired: ${deleteCalled}; error shown: ${errorShown}; message still visible: ${stillThere}`,
      });
      expect(
        errorShown,
        'a delete the server rejects must surface an error — a silent no-op leaves the user unsure whether ' +
          'the message was deleted',
      ).toBe(true);
    });

    test('a save that the server REJECTS (FAILURE envelope) must tell the user, not fail silently @ui', async ({
      page,
    }) => {
      // Accept Save's native confirm; Playwright would otherwise dismiss it and the save never fires.
      page.on('dialog', (d) => void d.accept());

      const subject = `QA save-fail ${Date.now()}`;
      const sent = Date.now();
      await page.route('**/katchup/katchupMessagesForSelectedContactID/**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 'SUCCESS',
            statusCode: 200,
            lastMsgID: 999000201,
            data: [
              {
                msgID: 999000201,
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
              },
            ],
          }),
        }),
      );
      // The transaction-count call feeds the confirm wording; keep it deterministic.
      await page.route('**/katchup/messageCountBetweenSenderAndReceiver/**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'SUCCESS', statusCode: 200, messageCount: 1, data: 1 }),
        }),
      );
      let saveCalled = false;
      await page.route('**/katchup/saveKatchupMessages/**', (route) => {
        saveCalled = true;
        return route.fulfill(FAILURE);
      });

      await openConversation(page, testData.victimKpostId);
      await settleFrames(page);

      const message = messageBySubject(page, subject);
      const seeded = await message
        .first()
        .waitFor({ state: 'visible', timeout: 10_000 })
        .then(() => true)
        .catch(() => false);
      expect(
        seeded,
        'the seeded sent message must render so the save action can be exercised',
      ).toBe(true);

      await openBellMenu(page, message);
      await page
        .getByRole('menuitem', { name: /^Save$/i })
        .click()
        .catch(() => undefined);
      await settleFrames(page);

      expect(
        saveCalled,
        'the save request must have fired (bell → Save → confirm) to exercise the flow',
      ).toBe(true);

      const errorShown = await page
        .locator(errorSignal, { hasText: /error|fail|could not|unable|try again|went wrong/i })
        .first()
        .isVisible()
        .catch(() => false);

      test.info().annotations.push({
        type: 'observed',
        description: `after a rejected save — save fired: ${saveCalled}; error shown: ${errorShown}`,
      });
      expect(
        errorShown,
        'a save the server rejects must surface an error — the handler has no else branch, so a FAILURE ' +
          'envelope is swallowed and the user believes the save succeeded',
      ).toBe(true);
    });
  },
);
