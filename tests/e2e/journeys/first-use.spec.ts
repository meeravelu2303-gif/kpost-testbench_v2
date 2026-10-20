import type { Page } from '@playwright/test';
import { STORAGE_STATE_2, TAGS } from '@config/constants';
import { testData } from '@config/test-data.config';
import { isSqlClient } from '@database/database-client';
import { domainFor } from '@fixtures/test-accounts';
import { expect, test } from '@fixtures';
import { settleFrames } from '../support/settle';
import { deleteSanityAccount, nextSanityIdentity } from '../support/sanity-account';
import {
  deleteSentMessage,
  openComposerFor,
  openConversation,
  sendMessage,
} from '../support/katchup';
import {
  deleteOpenMail,
  logoutFromUi,
  openMail,
  openSession,
  requireAccounts,
  requireFlags,
  sendMailFromUi,
  signInFromUi,
} from './support/journey';

/**
 * JOURNEY 1 · FIRST USE (RTM-E2E01) — the path a new person takes, end to end, in the browser.
 *
 * 1a. **Becoming a user:** sign up on the real screens (mobile OTP through the confirmed test gateway)
 *     → first login → Home → the profile shows the name they gave at signup → log out.
 * 1b. **First day:** one continuous signed-in session walks Home → own Profile → sends a first Katchup
 *     message → sends a first KMail — and the OTHER person (B, a second browser) receives both. Each
 *     write is deleted again in the UI.
 *
 * Two tests, not one, because a brand-new account has no conversations yet: starting a chat from it
 * needs the directory → add-contact route, which no spec has proven on live. 1b therefore runs the
 * first-day half on the seeded QA account, and the two halves together cover RTM-E2E01.
 */

/** The authenticated app shell (side menu) — present on every signed-in screen. */
const shell = (page: Page) => page.locator('.menu, nav, [class*="side-menu" i]').first();
const errorBoundary = (page: Page) =>
  page.locator('[role="alert"], body', { hasText: /something went wrong/i });

async function arriveAt(page: Page, route: string, urlRe: RegExp, step: string): Promise<void> {
  await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => undefined);
  await settleFrames(page).catch(() => undefined);
  await expect(page, `${step}: the route resolved`).toHaveURL(urlRe);
  await expect(shell(page), `${step}: the signed-in shell is present`).toBeVisible({
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

/** The password the signup half sets (fixed, so a re-run can sign the same account in). */
const SIGNUP_PASSWORD = 'QaBench@2026';

test.describe(
  'JOURNEY 1 · first use',
  {
    tag: [TAGS.ui, TAGS.journey, TAGS.auth, TAGS.katchup, TAGS.kmail, TAGS.regression],
    annotation: [{ type: 'requirement', description: 'RTM-E2E01' }],
  },
  () => {
    test.describe.configure({ timeout: 240_000 });

    test.describe('1a · becoming a user', () => {
      // No retries: a retry would sign up a SECOND throwaway account (owner: one per run).
      test.describe.configure({ retries: 0 });
      test.use({ storageState: { cookies: [], origins: [] } });
      requireFlags('SIGNUP_UI_LIFECYCLE', 'OTP_TEST_GATEWAY', 'TEST_DB_MODE');

      test(
        'a person signs up, signs in for the first time and sees their own name',
        { annotation: [{ type: 'requirement', description: 'RTM-E2E01' }] },
        async ({ signupPage, page, databases }) => {
          // One throwaway identity per run (sanitykpost<N>, removed afterwards) — the owner's rule
          // for accounts the bench creates (2026-10-20), shared with sanity-signup.spec.ts.
          const db = databases.for('kpost-api');
          if (!isSqlClient(db)) {
            test.skip(true, 'needs the KPOST_QA database to pick the identity and remove it');
            return;
          }
          const domain = domainFor('PERSONAL');
          const me = await nextSanityIdentity(db, domain);
          try {
            await test.step(`sign up ${me.kpostId} on the real screens`, async () => {
              await signupPage.goto();
              await signupPage.chooseAccountType('Personal');
              await signupPage.selectCountryLanguageDomain('India', 'English', domain);
              expect(await signupPage.requestMobileOtp(me.mobile), 'the mobile is free').toBe(
                'sent',
              );
              expect(
                await signupPage.enterMobileOtp(testData.bypassOtp),
                'the test-gateway code is accepted',
              ).toBe('verified');
              await signupPage.fillPersonalDetails({
                firstName: 'QA',
                lastName: 'Bench',
                gender: 'Female',
                dobDay: 15,
                dobMonth: 'June',
                dobYear: 1995,
                pincode: testData.pinCode,
                area: 'Chennai',
              });
              await signupPage.continueToKpostId();
              expect(await signupPage.choosePreferredKpostId(me.local), 'the id is free').toBe(
                'available',
              );
              await signupPage.setPasswordAndSubmit(SIGNUP_PASSWORD);
              await signupPage.confirmSuccessAndGoToLogin();
              await expect(page, 'signup ends on the login screen').toHaveURL(/\/login/, {
                timeout: 20_000,
              });
            });

            await test.step('first sign-in lands on Home', async () => {
              await signInFromUi(page, me.kpostId, SIGNUP_PASSWORD);
              await arriveAt(page, '/home', /\/home/, 'Home');
            });

            await test.step('the profile shows the name given at signup', async () => {
              await arriveAt(page, '/userprofile', /\/userprofile/, 'Profile');
              await expect(
                page.locator('.name_font_profile').first(),
                'the new user sees the name they signed up with',
              ).toContainText(/QA\s+Bench/i, { timeout: 20_000 });
            });

            await test.step('log out', async () => {
              await logoutFromUi(page);
            });
          } finally {
            await deleteSanityAccount(db, me);
          }
        },
      );
    });

    test.describe('1b · first day', () => {
      requireAccounts('A', 'B');
      requireFlags('KATCHUP_UI_LIFECYCLE', 'KMAIL_UI_LIFECYCLE');

      // The golden path is part of full sanity (RTM-E2E01's own plan: "sanity, one golden-path journey").
      test(
        'one session walks Home → Profile → first Katchup → first KMail, and B receives both',
        { tag: '@sanity' },
        async ({ page, browser }) => {
          const stamp = Date.now();
          const chatSubject = `QA journey chat ${stamp}`;
          const mailSubject = `QA journey mail ${stamp}`;
          const mailBody = `QA journey first mail ${stamp}`;
          const b = await openSession(browser, STORAGE_STATE_2);
          let chatSent = false;
          let mailSent = false;

          try {
            await test.step('Home', () => arriveAt(page, '/home', /\/home/, 'Home'));

            await test.step('own Profile shows who they are', async () => {
              await arriveAt(page, '/userprofile', /\/userprofile/, 'Profile');
              await expect(
                page.locator('.name_font_profile').first(),
                'the user sees their own name',
              ).toBeVisible({ timeout: 20_000 });
              await expect(
                page.getByText(/^Edit Profile$/i).first(),
                'Edit Profile is offered',
              ).toBeVisible({ timeout: 20_000 });
            });

            await test.step('first Katchup message, and B receives it', async () => {
              await openComposerFor(page, testData.victimKpostId);
              await sendMessage(page, chatSubject, 'QA journey — first Katchup message');
              chatSent = true;
              await b.page.goto('/katchup', { waitUntil: 'domcontentloaded', timeout: 45_000 });
              await expect(
                b.page.getByText(chatSubject).first(),
                'B receives the first Katchup message',
              ).toBeVisible({ timeout: 30_000 });
            });

            await test.step('first KMail, and B receives and reads it', async () => {
              await sendMailFromUi(page, testData.victimKpostId, mailSubject, mailBody);
              mailSent = true;
              await openMail(b.page, mailSubject);
              await expect(
                b.page.getByText(mailBody, { exact: false }).first(),
                'B reads exactly what was written (#1348 if empty)',
              ).toBeVisible({ timeout: 20_000 });
            });

            await test.step('back to Home: still signed in after every module', () =>
              arriveAt(page, '/home', /\/home/, 'Back home'));
          } finally {
            if (mailSent) {
              await deleteOpenMail(b.page).catch(() => false);
              await openMail(page, mailSubject)
                .then(() => deleteOpenMail(page))
                .catch(() => false);
            }
            if (chatSent) {
              await openConversation(page, testData.victimKpostId)
                .then(() => deleteSentMessage(page, chatSubject))
                .catch(() => undefined);
            }
            await b.context.close();
          }
        },
      );
    });
  },
);
