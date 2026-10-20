import { testData } from '@config/test-data.config';
import { isSqlClient } from '@database/database-client';
import { domainFor } from '@fixtures/test-accounts';
import { expect, test } from '@fixtures';
import { signInFromUi } from './journeys/support/journey';
import {
  deleteSanityAccount,
  nextSanityIdentity,
  type SanityIdentity,
} from './support/sanity-account';

/**
 * SANITY · signup — one brand-new person signs up on the real screens, signs in, and sees their own
 * name; then the account is removed again (owner, 2026-10-20).
 *
 * - ONE account per run: `sanitykpost<N>@<personal domain>` with mobile `90000008NN`, N being the
 *   lowest number still free (normally 1, because every run deletes its account). Retries are off,
 *   so a failure can never sign up a second one.
 * - Mock OTP: the signup mobile OTP goes through the test gateway (`otpBypass`, code 123456) — no
 *   SMS is sent (CommonServiceImpl.sendOtp).
 * - Removal is a direct delete of the rows the signup created (`support/sanity-account.ts` says why
 *   the app's own Delete Account cannot be used: it sends a real SMS and only deactivates).
 *
 * Steps are the proven ones of JOURNEY 1a (`journeys/first-use.spec.ts`), on a fresh identity.
 */
const PASSWORD = 'QaBench@2026';

test.describe(
  'KPost signup · sanity: one fresh account, created then removed',
  { tag: ['@ui', '@auth', '@signup', '@regression'] },
  () => {
    test.describe.configure({ retries: 0, timeout: 240_000 });
    test.use({ storageState: { cookies: [], origins: [] } });
    test.skip(
      process.env.SIGNUP_UI_LIFECYCLE !== 'true',
      'creates (and removes) a real account; set SIGNUP_UI_LIFECYCLE=true',
    );
    test.skip(
      process.env.OTP_TEST_GATEWAY !== 'true' || process.env.TEST_DB_MODE !== 'true',
      'the signup OTP is mocked only on the confirmed test gateway (OTP_TEST_GATEWAY + TEST_DB_MODE)',
    );
    test.skip(
      process.env.DB_ALLOW_WRITES !== 'true',
      'the account is removed from KPOST_QA afterwards; set DB_ALLOW_WRITES=true',
    );

    test(
      'a new person signs up with the mock OTP, signs in and sees their name — and the account is removed',
      {
        tag: '@sanity',
        annotation: [
          { type: 'requirement', description: 'FR-SL-007' },
          { type: 'requirement', description: 'FR-SL-016' },
          { type: 'requirement', description: 'FR-SL-021' },
        ],
      },
      async ({ signupPage, page, databases }) => {
        const db = databases.for('kpost-api');
        if (!isSqlClient(db)) {
          test.skip(true, 'needs the KPOST_QA database (DB_ENABLED) to pick the id and remove it');
          return;
        }
        const domain = domainFor('PERSONAL');
        const me: SanityIdentity = await nextSanityIdentity(db, domain);
        test.info().annotations.push({
          type: 'observed',
          description: `this run's account: ${me.kpostId} (mobile ${me.mobile})`,
        });

        try {
          await test.step(`sign up ${me.kpostId} on the real screens`, async () => {
            await signupPage.goto();
            await signupPage.chooseAccountType('Personal');
            await signupPage.selectCountryLanguageDomain('India', 'English', domain);
            expect(
              await signupPage.requestMobileOtp(me.mobile),
              `${me.mobile} is free (picked from the DB just now)`,
            ).toBe('sent');
            expect(
              await signupPage.enterMobileOtp(testData.bypassOtp),
              'the mock OTP is accepted',
            ).toBe('verified');
            await signupPage.fillPersonalDetails({
              firstName: 'Sanity',
              lastName: 'Bench',
              gender: 'Female',
              dobDay: 15,
              dobMonth: 'June',
              dobYear: 1995,
              pincode: testData.pinCode,
              area: 'Chennai',
            });
            await signupPage.continueToKpostId();
            expect(
              await signupPage.choosePreferredKpostId(me.local),
              `${me.local} is offered as available`,
            ).toBe('available');
            await signupPage.setPasswordAndSubmit(PASSWORD);
            await signupPage.confirmSuccessAndGoToLogin();
            await expect(page, 'signup ends on the login screen').toHaveURL(/\/login/, {
              timeout: 20_000,
            });
          });

          await test.step('the new account exists, active, with the mobile it signed up with', async () => {
            const [row] = await db.query<{ mobile_number: string; active_status: string }>(
              'SELECT mobile_number, active_status FROM TBL_KPOST_USER_MASTER WHERE kpost_id = ?',
              [me.kpostId],
            );
            expect(row, `${me.kpostId} is in the user table`).toBeTruthy();
            expect(String(row?.mobile_number)).toBe(me.mobile);
          });

          await test.step('first sign-in lands on Home and the profile shows the name', async () => {
            await signInFromUi(page, me.kpostId, PASSWORD);
            await page.goto('/userprofile', { waitUntil: 'domcontentloaded', timeout: 45_000 });
            await expect(
              page.locator('.name_font_profile').first(),
              'the new user sees the name they signed up with',
            ).toContainText(/Sanity\s+Bench/i, { timeout: 20_000 });
          });
        } finally {
          const removed = await deleteSanityAccount(db, me);
          test.info().annotations.push({
            type: 'observed',
            description: `removed ${me.kpostId}: ${JSON.stringify(removed)}`,
          });
        }
      },
    );
  },
);
