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
 * NEEDS-LIVE-TUNING: the stubbed message shape is modelled from the source consumer; if the live
 * markup differs the XSS assertion can only PASS falsely (never fail falsely — a non-rendering stub
 * simply won't fire the payload), so it is safe to ship and refine from the first run's screenshot.
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

    await page.route(THREAD, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'SUCCESS',
          statusCode: 200,
          data: [
            {
              msgID: 999999001,
              messageType: 0,
              groupFlag: 'false',
              subject: 'QA XSS probe',
              senderKpostID: testData.victimKpostId,
              receiverKpostID: testData.kpostId,
              senderName: 'QA Victim',
              createdDate: Date.now(),
              // Non-JSON raw HTML → hits the unsanitised dangerouslySetInnerHTML sink (L4408).
              actualMessage:
                '<img src=x onerror="window.__xss=true;document.title=\'XSSFIRED\'"><svg onload="window.__xss=true">',
            },
          ],
        }),
      }),
    );

    await openConversation(page, testData.victimKpostId);
    await settleFrames(page);
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
