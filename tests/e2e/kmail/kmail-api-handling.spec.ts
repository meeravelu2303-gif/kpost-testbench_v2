import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { settleFrames } from '../support/settle';

/**
 * KMail inbox — API response handling. KMail is the other messaging core but, unlike Home and Katchup,
 * has no failure-handling coverage. Its inbox list loads from `POST /common/getKmailDashboardMsg/`
 * (KmailEndPointURL). The frontend's service layer uses the same empty-catch idiom as the rest of the
 * app, so a failing/empty load can render a confident-but-false empty inbox with no error — an outage
 * looks identical to "you have no mail" (the #1322 class, proven on Home).
 *
 * DETERMINISTIC stubs of the real inbox-load endpoint. Each guards that the load actually fired, so a
 * flow difference surfaces as a clear failure rather than a false pass. Asserts correct behaviour.
 */
test.describe(
  'KPost KMail · inbox API failure handling',
  {
    tag: ['@ui', '@kmail', '@regression'],
    annotation: [{ type: 'non-functional', description: 'resilience' }],
  },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a live QA account',
    );

    const INBOX = '**/common/getKmailDashboardMsg/**';
    const errorSignal =
      '.Toastify__toast, [role="alert"], .alert-danger, [class*="error" i], [class*="danger" i]';

    test('a failing inbox load (FAILURE envelope) shows an error, not a silent-empty inbox @ui', async ({
      page,
    }) => {
      let called = false;
      await page.route(INBOX, (route) => {
        called = true;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 'FAILURE',
            statusCode: 500,
            message: 'Internal Server Error',
          }),
        });
      });

      await page.goto('/kmail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => undefined);
      await settleFrames(page).catch(() => undefined);

      // KMail shows its loading splash first and only then requests the inbox (live 2026-10-15) — wait
      // for the request instead of checking straight after the page's load event.
      await expect
        .poll(() => called, {
          message: 'the inbox-load endpoint must fire on /kmail (else the stub/flow is wrong)',
          timeout: 30_000,
        })
        .toBe(true);
      const shown = await page
        .locator(errorSignal, { hasText: /error|fail|unable|could not|try again|went wrong/i })
        .first()
        .waitFor({ state: 'visible', timeout: 8_000 })
        .then(() => true)
        .catch(() => false);
      test.info().annotations.push({
        type: 'observed',
        description: shown
          ? 'error shown on failed inbox load'
          : 'inbox load failed with NO visible error',
      });
      expect(
        shown,
        'a failed inbox load must surface an error — otherwise an outage is indistinguishable from an empty inbox (#1352)',
      ).toBe(true);
    });

    test('an inbox load that errors at the network level still tells the user @ui', async ({
      page,
    }) => {
      let called = false;
      await page.route(INBOX, (route) => {
        called = true;
        return route.abort('failed');
      });

      await page.goto('/kmail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => undefined);
      await settleFrames(page).catch(() => undefined);

      await expect
        .poll(() => called, {
          message: 'the inbox-load endpoint must fire on /kmail',
          timeout: 30_000,
        })
        .toBe(true);
      const shown = await page
        .locator(errorSignal, { hasText: /error|fail|unable|could not|try again|went wrong/i })
        .first()
        .waitFor({ state: 'visible', timeout: 8_000 })
        .then(() => true)
        .catch(() => false);
      test.info().annotations.push({
        type: 'observed',
        description: shown
          ? 'error shown on network error'
          : 'network error produced NO visible feedback',
      });
      expect(
        shown,
        'a network-level inbox load error must surface feedback, not a silent blank (#1352)',
      ).toBe(true);
    });
  },
);
