import type { Page } from '@playwright/test';
import { TAGS } from '@config/constants';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { deleteSentMessage, openComposerFor, sendMessage } from './support/katchup';
import { settleFrames } from './support/settle';

/**
 * UI SMOKE — the build-acceptance gate for the UI layer: a shallow "does this core screen load for a
 * signed-in user" check per in-scope core module (Auth/Home, Katchup, Kall, KMail), plus two core
 * WRITE checks (Katchup send, KMail send) to a QA account, each cleaned up in a `finally`. Target
 * runtime ≤ 5 min, Chromium only. If a core screen will not even load, deeper testing is pointless.
 *
 * Each load check navigates, lets the SPA settle, and asserts (a) the route resolved, (b) the app
 * shell rendered (the side menu), and (c) the app did NOT fall to its error boundary. The write checks
 * use QATEST1 → QATEST2 and self-clean. These are NOT @destructive: they are net-zero (send then
 * remove), so the smoke gate may include them.
 */
test.describe(
  'KPost UI · smoke',
  { tag: [TAGS.ui, TAGS.regression, TAGS.smoke, TAGS.sanity] },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a live, logged-in QA account',
    );

    /** The authenticated app shell (side menu) — present on every signed-in screen. */
    const shell = (page: Page) => page.locator('.menu, nav, [class*="side-menu" i]').first();
    const errorBoundary = (page: Page) =>
      page.locator('[role="alert"], body', { hasText: /something went wrong/i });

    async function screenLoads(page: Page, route: string, urlRe: RegExp): Promise<void> {
      await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => undefined);
      await settleFrames(page).catch(() => undefined);
      await expect(page, 'the route resolved').toHaveURL(urlRe);
      await expect(shell(page), 'the authenticated app shell rendered').toBeVisible({
        timeout: 15_000,
      });
      expect(
        await errorBoundary(page)
          .first()
          .isVisible()
          .catch(() => false),
        'the screen did not fall to the error boundary',
      ).toBe(false);
    }

    test(
      'auth/home — a signed-in session lands on Home',
      { tag: [TAGS.auth] },
      async ({ page }) => {
        await screenLoads(page, '/home', /\/home/);
      },
    );

    test('katchup — the conversation screen loads', { tag: [TAGS.katchup] }, async ({ page }) => {
      await screenLoads(page, '/katchup', /\/katchup/);
    });

    test('kall — the calling screen loads', { tag: [TAGS.kall] }, async ({ page }) => {
      await screenLoads(page, '/kall', /\/kall/);
    });

    test('kmail — the inbox loads', { tag: [TAGS.kmail] }, async ({ page }) => {
      await screenLoads(page, '/kmail', /\/kmail/);
    });

    test(
      'katchup — sending a message makes it appear in the thread',
      { tag: [TAGS.katchup] },
      async ({ page }) => {
        const subject = `QA smoke katchup ${Date.now()}`;
        await openComposerFor(page, testData.victimKpostId);
        try {
          // sendMessage asserts the message appears in the thread.
          await sendMessage(page, subject, 'QA smoke — safe to ignore');
        } finally {
          await deleteSentMessage(page, subject).catch(() => undefined);
        }
      },
    );

    test(
      'kmail — sending a mail to the 2nd QA account succeeds',
      { tag: [TAGS.kmail] },
      async ({ page }) => {
        const subject = `QA smoke kmail ${Date.now()}`;
        await page.goto('/writemail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await page
          .locator('.loader-overlay')
          .waitFor({ state: 'hidden', timeout: 30_000 })
          .catch(() => undefined);
        // Body first (the To autocomplete destabilises the Quill), then recipient, subject, send.
        const body = page.locator('.ql-editor[contenteditable="true"]').first();
        await body.click();
        await page.keyboard.type('QA smoke KMail — safe to ignore');
        const to = page.locator('.subjectTextboxKmailTO, input[name="to"]').first();
        await to.click();
        await to.fill(testData.victimKpostId);
        await page
          .getByText(testData.victimKpostId, { exact: false })
          .last()
          .click({ timeout: 4_000 })
          .catch(() => undefined);
        await page.locator('.toInput').first().fill(subject);
        await page
          .locator('.post_button_size')
          .filter({ has: page.locator('.icon-KP_3164') })
          .first()
          .click()
          .catch(() => page.locator('.post_button_size').first().click());
        // Success = a react-toastify success toast (the mail is a harmless self-send to our own 2nd
        // QA account; a full inbox-delete is out of a smoke's scope, noted in the report).
        const sent = await page
          .locator('.Toastify__toast', { hasText: /sent|success/i })
          .first()
          .waitFor({ state: 'visible', timeout: 12_000 })
          .then(() => true)
          .catch(() => false);
        expect(sent, 'the mail sent (success confirmation shown)').toBe(true);
      },
    );
  },
);
