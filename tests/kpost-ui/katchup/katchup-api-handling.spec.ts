import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { openConversation } from '../support/katchup';
import { settleFrames } from '../support/settle';

/**
 * Katchup thread load (katchupMessagesForSelectedContactID, stubbed): a stored raw-HTML body must
 * render inert on open, and a failed load must show an error rather than an empty conversation.
 */
test.describe(
  'KPost Katchup · thread API handling + stored-XSS on open',
  {
    tag: ['@ui', '@katchup', '@regression'],
    annotation: [{ type: 'non-functional', description: 'resilience' }],
  },
  () => {
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
      // The payload sets this flag, so execution is caught even without a dialog.
      await page.addInitScript(() => {
        (window as unknown as { __xss?: boolean }).__xss = false;
      });

      // Mirrors a real thread response: the send API stores a raw-HTML body verbatim, and a non-JSON
      // body is rendered via dangerouslySetInnerHTML.
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
                // Non-JSON raw HTML reaches the unsanitised sink.
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

      // Guard against a false pass: the stubbed message must render, or the sink was never exercised.
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

    test('a conversation with no messages says so @ui', async ({ page }) => {
      // The server's answer for an empty conversation (KatchupMessage.js fetchMoreMessage).
      await page.route(THREAD, (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'SUCCESS', statusCode: 200, data: [] }),
        }),
      );
      await openConversation(page, testData.victimKpostId);
      await expect(
        page.locator('.Toastify__toast').filter({ hasText: 'No more messages available' }).first(),
        'the user is told there are no messages',
      ).toBeVisible({ timeout: 10_000 });
    });

    test('a Recents list that fails to load says so @ui', async ({ page }) => {
      // components/RecentMessage.js recentMessageAsync: a failed dashboard load is reported.
      await page.route('**/dashboard/katchupDashboardMsg/**', (route) =>
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'FAILURE', statusCode: 500, message: '' }),
        }),
      );
      await page.goto('/katchup', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await expect(
        page
          .locator('.Toastify__toast')
          .filter({ hasText: 'Could not load recent messages. Please try again.' })
          .first(),
        'the user is told the list could not load',
      ).toBeVisible({ timeout: 15_000 });
    });
  },
);
