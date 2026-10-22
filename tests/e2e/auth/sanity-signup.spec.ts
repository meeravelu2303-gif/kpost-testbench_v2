import { testData } from '@config/test-data.config';
import { isSqlClient } from '@database/database-client';
import { domainFor } from '@fixtures/test-accounts';
import { expect, test } from '@fixtures';
import { signInFromUi } from '../journeys/support/journey';
import {
  deleteSanityAccount,
  nextSanityIdentity,
  type SanityIdentity,
} from '../support/sanity-account';

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
          {
            type: 'cross-layer',
            description:
              'Signup: sign up on screen → signupLogin/signup → TBL_KPOST_USER_MASTER + TBL_KPOST_USER_PROFILE',
          },
          // The whole Personal signup, end to end, each step asserted (screens + the saved row).
          { type: 'requirement', description: 'FR-SL-001..005' },
          { type: 'requirement', description: 'FR-SL-006..008' },
          { type: 'requirement', description: 'FR-SL-009..015' },
          { type: 'requirement', description: 'FR-SL-016..018' },
          { type: 'requirement', description: 'FR-SL-019..022' },
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
            // FR-SL-018: an id someone already has is refused.
            expect(
              await signupPage.kpostIdValidationState('qatest1'),
              'a taken KPOST ID (qatest1) is refused',
            ).toBe('taken');
            // FR-SL-017: KPOST suggests ids, and they are genuinely free.
            const { suggestions, picked } = await signupPage.pickKpostIdSuggestion();
            expect(suggestions.length, 'KPOST offers at least one suggestion').toBeGreaterThan(0);
            const takenSuggestions = await db.query<{ kpost_id: string }>(
              `SELECT kpost_id FROM TBL_KPOST_USER_MASTER WHERE kpost_id IN (${suggestions
                .map(() => '?')
                .join(',')})`,
              suggestions.map((s) => (s.includes('@') ? s : `${s}@${domain}`).toLowerCase()),
            );
            expect(
              takenSuggestions.map((r) => r.kpost_id),
              'no suggested id belongs to an existing account',
            ).toEqual([]);
            await expect(
              page.getByPlaceholder('Enter Preferred KPOST ID'),
              'picking a suggestion fills the KPOST ID field',
            ).toHaveValue(picked);
            // Then this run's own id (so the clean-up knows exactly what to remove).
            expect(
              await signupPage.choosePreferredKpostId(me.local),
              `${me.local} is offered as available`,
            ).toBe('available');
            // Layer 2: the signup request the screen sends, and its answer.
            const signupAnswer = page.waitForResponse(
              (r) => r.url().includes('/signupLogin/signup'),
              {
                timeout: 30_000,
              },
            );
            await signupPage.setPasswordAndSubmit(PASSWORD);
            expect((await signupAnswer).status(), 'the server accepts the signup').toBeLessThan(
              300,
            );
            await signupPage.confirmSuccessAndGoToLogin();
            await expect(page, 'signup ends on the login screen').toHaveURL(/\/login/, {
              timeout: 20_000,
            });
          });

          await test.step('the new account exists, active, with the mobile it signed up with', async () => {
            const [row] = await db.query<{
              mobile_number: string;
              first_name: string;
              last_name: string;
              gender: string;
              date_of_birth: string;
              pin_code: string;
              city: string;
              state: string;
            }>(
              `SELECT u.mobile_number, u.first_name, u.last_name, u.gender, u.date_of_birth,
                      p.pin_code, p.city, p.state
                 FROM TBL_KPOST_USER_MASTER u LEFT JOIN TBL_KPOST_USER_PROFILE p ON p.kpost_id = u.kpost_id
                WHERE u.kpost_id = ?`,
              [me.kpostId],
            );
            expect(row, `${me.kpostId} is in the user table`).toBeTruthy();
            test.info().annotations.push({
              type: 'observed',
              description: `saved: ${JSON.stringify({ ...row, mobile_number: undefined })}`,
            });
            // FR-SL-006..015: what was entered on the screens is what was saved.
            expect(String(row?.mobile_number), 'the verified mobile').toBe(me.mobile);
            expect(row?.first_name, 'the first name').toBe('Sanity');
            expect(row?.last_name, 'the last name').toBe('Bench');
            expect(String(row?.gender), 'the gender').toMatch(/^f/i);
            // A DATE column comes back as a Date at local midnight; compare the calendar day.
            const dob = new Date(String(row?.date_of_birth));
            expect(
              [dob.getFullYear(), dob.getMonth() + 1, dob.getDate()],
              'the date of birth',
            ).toEqual([1995, 6, 15]);
            expect(String(row?.pin_code), 'the postal pincode').toBe(testData.pinCode);
            expect(row?.city || row?.state, 'the address filled in from the pincode').toBeTruthy();
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
