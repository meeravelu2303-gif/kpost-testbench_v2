import type { Page } from '@playwright/test';
import { TAGS } from '@config/constants';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { deleteSentMessage, openComposerFor, sendMessage } from './support/katchup';
import { settleFrames } from './support/settle';

/**
 * END-TO-END FIRST-USE JOURNEY (RTM-E2E01).
 *
 * Signup is OTP-gated on the test environment, so the journey a real first-time user takes once
 * their account exists is modelled here: a SINGLE continuous signed-in session that walks across
 * modules without re-authenticating — land on Home, check their own profile, send their first
 * Katchup message, and reach their mailbox. This differs from the smoke suite (which checks each
 * module in its OWN isolated session): the point here is continuity — that one session can carry a
 * user from one module to the next the way a real person moves through the app in a sitting.
 *
 * Deliberately shallow per step and robust: each hop asserts the route resolved, the authenticated
 * shell rendered, and the app did not fall to its error boundary; the one write (a Katchup message
 * to the 2nd QA account) is net-zero and self-cleans. No attachment is used — attachment upload is
 * a known open bug (KP-ATT405) and is covered separately in katchup-content-correctness.
 */
test.describe(
  'KPost UI · end-to-end first-use journey',
  { tag: [TAGS.ui, TAGS.regression], annotation: [{ type: 'requirement', description: 'RTM-E2E01' }] },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench') || !testData.victimKpostId,
      'needs a live, logged-in QA account and a 2nd QA account to message',
    );

    /** The authenticated app shell (side menu) — present on every signed-in screen. */
    const shell = (page: Page) => page.locator('.menu, nav, [class*="side-menu" i]').first();
    const errorBoundary = (page: Page) =>
      page.locator('[role="alert"], body', { hasText: /something went wrong/i });

    async function arriveAt(page: Page, route: string, urlRe: RegExp, step: string): Promise<void> {
      await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => undefined);
      await settleFrames(page).catch(() => undefined);
      await expect(page, `${step}: the route resolved`).toHaveURL(urlRe);
      await expect(shell(page), `${step}: the authenticated shell is present`).toBeVisible({
        timeout: 15_000,
      });
      expect(
        await errorBoundary(page)
          .first()
          .isVisible()
          .catch(() => false),
        `${step}: the screen did not fall to the error boundary`,
      ).toBe(false);
    }

    test('a user moves through Home, Profile, Katchup and KMail in one continuous session @ui', async ({
      page,
    }) => {
      const subject = `QA journey ${Date.now()}`;

      // 1) Land on Home — the signed-in user's starting point.
      await arriveAt(page, '/home', /\/home/, 'Home');

      // 2) Their own profile loads and shows their identity (name + Edit Profile), same session.
      await arriveAt(page, '/userprofile', /\/userprofile/, 'Profile');
      await expect(
        page.locator('.name_font_profile').first(),
        'Profile: the user sees their own name',
      ).toBeVisible({ timeout: 20_000 });
      await expect(
        page.getByText(/^Edit Profile$/i).first(),
        'Profile: the Edit Profile control is available',
      ).toBeVisible({ timeout: 20_000 });

      // 3) Send their first Katchup message to the 2nd QA account; it appears in the thread. Net-zero.
      await openComposerFor(page, testData.victimKpostId);
      try {
        await sendMessage(page, subject, 'QA first-use journey — safe to ignore');
      } finally {
        await deleteSentMessage(page, subject).catch(() => undefined);
      }

      // 4) Reach the mailbox in the same session.
      await arriveAt(page, '/kmail', /\/kmail/, 'KMail');

      // 5) Return Home — the session is still valid after traversing every module.
      await arriveAt(page, '/home', /\/home/, 'Back home');
    });
  },
);
