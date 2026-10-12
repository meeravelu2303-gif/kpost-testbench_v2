import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { openConversation } from './support/katchup';
import { settleFrames } from './support/settle';

/**
 * Katchup thread — realistic API-response handling and the stored-XSS sink on OPEN.
 *
 * Both hinge on `POST /katchup/katchupMessagesForSelectedContactID/` (the thread-load fired when a
 * conversation is opened — `Services/Katchup.js:85`, consumed in `KatchupMessage.js:5579`). We stub
 * that one call; everything else loads normally.
 *
 * Why these are REAL (not artificial):
 *  - Stored XSS: the body renderer `renderMessage()` (`bubble/KatchupMessage/KatchupMessage.js:4408`)
 *    injects a NON-JSON `actualMessage` via `dangerouslySetInnerHTML` with NO sanitising. The existing
 *    composer-fuzz spec can't reach it (Quill always stores JSON → the safe QuillViewer path), but a
 *    message whose body is raw HTML — which the send API accepts and stores verbatim — executes
 *    `<img onerror>` / `<svg onload>` the moment the victim opens the thread. No interaction beyond open.
 *  - A 500/timeout on the thread-load is a real server failure; the catch (`KatchupMessage.js:5710`)
 *    does `setMessageArr([])`, so the user sees an EMPTY conversation with no error.
 *
 * LIVE-PROVEN (2026-10-12): the stubbed message shape is NOT guesswork — the real `sendMessage` API
 * was driven end-to-end (qatest1 -> qatest2): it accepted a raw-HTML `actualMessage`, stored it, and
 * `katchupMessagesForSelectedContactID` echoed it back BYTE-FOR-BYTE (msgID 855056, isJSON-parseable
 * === false), then the probe was recalled. The stub below mirrors that captured message field-for-
 * field. A render-guard still fails the test if the stub does not render, so the XSS verdict can
 * never be a false pass.
 */
test.describe('KPost Katchup · thread API handling + stored-XSS on open', { tag: '@ui' }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench') || !testData.victimKpostId,
    'needs both QA accounts',
  );

  const THREAD = '**/katchup/katchupMessagesForSelectedContactID/**';

  test('opening a thread whose stored body is raw HTML must NOT execute it (stored XSS) @ui', async ({
    page,
  }) => {
    let dialogFired = false;
    page.on('dialog', (d) => {
      dialogFired = true;
      void d.dismiss();
    });
    // A JS error-boundary signal for the onerror/onload path (which may not open a dialog if the
    // payload calls something other than alert): expose a flag the payload would set.
    await page.addInitScript(() => {
      (window as unknown as { __xss?: boolean }).__xss = false;
    });

    // The message object below mirrors a REAL thread response field-for-field (captured live
    // 2026-10-12, msgID 855056): a raw-HTML `actualMessage` that the live `sendMessage` API accepts,
    // stores and echoes back VERBATIM (confirmed round-trip — HTTP 200, returned unchanged,
    // isJSON-parseable === false). So this is exactly what the server returns, not a contrived shape;
    // `renderMessage()` (KatchupMessage.js:4386) branches only on `isJSON(text)` and feeds a non-JSON
    // body straight to `dangerouslySetInnerHTML` (L4408) with no sanitiser — `isHtml` is never read.
    const sent = Date.now();
    await page.route(THREAD, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'SUCCESS',
          statusCode: 200,
          lastMsgID: 855056,
          data: [
            {
              msgID: 855056,
              sender: testData.victimKpostId,
              receiver: testData.kpostId,
              messageType: 0,
              // Non-JSON raw HTML → hits the unsanitised dangerouslySetInnerHTML sink (L4408).
              actualMessage:
                '<img src=x onerror="window.__xss=true;document.title=\'XSSFIRED\'">QA XSS PROBE safe-to-delete',
              status: 0,
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
              subject: 'QA XSS PROBE safe-to-delete',
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
        }),
      }),
    );

    await openConversation(page, testData.victimKpostId);
    await settleFrames(page);

    // Guard against a FALSE PASS: the stubbed message must actually render (so the sink was exercised).
    // If the thread shows "No messages" instead, the stub shape is wrong and the XSS result is meaningless.
    // The visible text is everything after the <img> tag in the raw-HTML body.
    const rendered = await page
      .getByText('QA XSS PROBE safe-to-delete')
      .first()
      .isVisible()
      .catch(() => false);
    expect(
      rendered,
      'the stubbed message must render (else the XSS sink was never exercised — fix the stub shape)',
    ).toBe(true);

    const onerrorFired = await page.evaluate(
      () => (window as unknown as { __xss?: boolean }).__xss === true,
    );

    test.info().annotations.push({
      type: 'observed',
      description: `dialog fired: ${dialogFired}; onerror/onload fired: ${onerrorFired}; title: ${await page.title()}`,
    });
    expect(
      dialogFired || onerrorFired,
      'a stored raw-HTML message body must render INERT — onerror/onload/script must never execute on open',
    ).toBe(false);
  });

  test('a thread-load that fails (HTTP 500) shows an error, not a silent empty conversation @ui', async ({
    page,
  }) => {
    await page.route(THREAD, (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'FAILURE',
          statusCode: 500,
          message: 'Internal Server Error',
        }),
      }),
    );

    await openConversation(page, testData.victimKpostId);
    await settleFrames(page);

    const errorShown = await page
      .locator('.Toastify__toast, [class*="toast"], [role="alert"], [class*="error"]', {
        hasText: /error|fail|try again|unable|could not|went wrong/i,
      })
      .first()
      .waitFor({ state: 'visible', timeout: 8_000 })
      .then(() => true)
      .catch(() => false);

    test.info().annotations.push({
      type: 'observed',
      description: errorShown
        ? 'error shown on thread-load failure'
        : 'thread-load failed with NO visible error (silent empty conversation)',
    });
    expect(
      errorShown,
      'a failed thread-load must tell the user, not silently render an empty conversation',
    ).toBe(true);
  });
});
