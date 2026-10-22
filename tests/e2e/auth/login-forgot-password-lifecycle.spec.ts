import { testData } from '@config/test-data.config';
import { suiteFor } from '@config/ownership.config';
import { isSqlClient } from '@database/database-client';
import { expect, test } from '@fixtures';

/**
 * The FULL forgot-password reset — request OTP → verify → set the password → log in with it — with
 * exactly ONE real SMS per run (owner, 2026-10-20).
 *
 * ## Why the SMS is real, and how it is kept to one
 *
 * `forgotPassword` never applies the test gateway's OTP bypass (UserProfileServiceImpl): clicking
 * "Forgot Password ?" texts a random 6-digit code to the account's registered mobile. So:
 * - the link is clicked ONCE, and "Resend OTP" is never touched;
 * - retries are OFF for this file — a failed attempt is never repeated in the same run;
 * - the code is read from the test database (TBL_KPOST_OTP_VALIDATION, the row the request just
 *   wrote), so nobody has to read the phone;
 * - every other test that opens the dialog answers the request in the browser instead
 *   (`support/no-real-sms.ts`), and the production guard blocks any API call to these senders.
 *
 * ## Never strands the account
 *
 * It runs only on the dedicated spare account (`QA_FORGOT_PASSWORD_KPOST_ID`, qatest6), and it resets
 * the password TO THE SAME VALUE the account already has: the server accepts that (no same-password
 * rule), so there is nothing to restore and no second SMS is ever needed. The reset is still proven
 * to have been written: bcrypt salts every save, so the stored hash must change — and the account
 * must sign in with the password afterwards.
 */
test.describe(
  'KPost login · forgot-password full reset cycle',
  { tag: ['@ui', '@auth', '@regression'] },
  () => {
    test.describe.configure({ retries: 0, timeout: 180_000 });
    test.use({ storageState: { cookies: [], origins: [] } });

    test.skip(
      process.env.LOGIN_UI_LIFECYCLE !== 'true',
      'logs in and out repeatedly; set LOGIN_UI_LIFECYCLE=true',
    );
    test.skip(
      process.env.FORGOT_PASSWORD_SMS !== 'true',
      'sends ONE real SMS to the spare account; set FORGOT_PASSWORD_SMS=true (the run levels do)',
    );
    test.skip(
      !testData.forgotPasswordKpostId || testData.forgotPasswordKpostId.includes('no.such.user'),
      'needs a real spare account — set QA_FORGOT_PASSWORD_KPOST_ID (never QA_KPOST_ID)',
    );

    test(
      "resetting the spare account's password via OTP actually takes effect @ui",
      {
        tag: '@sanity',
        annotation: [
          { type: 'requirement', description: 'RTM-SEC03' },
          {
            type: 'cross-layer',
            description:
              'Forgot password: reset on screen → validateOTP / forgotPasswordUpdate → TBL_KPOST_USER_MASTER password hash + TBL_KPOST_OTP_VALIDATION',
          },
        ],
      },
      async ({ loginPage, page, databases, request }) => {
        const db = databases.for('kpost-api');
        if (!isSqlClient(db)) {
          test.skip(true, 'needs the KPOST_QA database (DB_ENABLED) to read the OTP that was sent');
          return;
        }
        const spareId = testData.forgotPasswordKpostId.toLowerCase();
        const password = testData.password;

        const [user] = await db.query<{
          mobile_number: string;
          password: string;
          country_id: string;
        }>(
          'SELECT mobile_number, password, country_id FROM TBL_KPOST_USER_MASTER WHERE kpost_id = ?',
          [spareId],
        );
        expect(user, `${spareId} exists`).toBeTruthy();
        const mobile = String(user?.mobile_number);
        const hashBefore = String(user?.password);
        const [last] = await db.query<{ id: string }>(
          'SELECT COALESCE(MAX(id), 0) AS id FROM TBL_KPOST_OTP_VALIDATION WHERE mobile_number = ?',
          [mobile],
        );
        const lastIdBefore = Number(last?.id ?? 0);

        await test.step('request the reset code — the ONE real SMS of this run', async () => {
          await loginPage.goto();
          await loginPage.requestPasswordResetOtp(spareId);
        });

        const otp = await test.step('read the code the server just stored', async () => {
          let code = '';
          await expect
            .poll(
              async () => {
                const [row] = await db.query<{ otp: string }>(
                  `SELECT otp FROM TBL_KPOST_OTP_VALIDATION
                    WHERE mobile_number = ? AND type = 'forgot Password' AND id > ?
                    ORDER BY id DESC LIMIT 1`,
                  [mobile, lastIdBefore],
                );
                code = row ? String(row.otp) : '';
                return code.length;
              },
              { message: 'the reset request stored a 6-digit code', timeout: 30_000 },
            )
            .toBe(6);
          return code;
        });

        await test.step('enter the code and set the password', async () => {
          expect(await loginPage.enterPasswordResetOtp(otp), 'the texted code is accepted').toBe(
            'verified',
          );
          await loginPage.submitNewPassword(password);
          await expect(
            loginPage.loginIdInput,
            'the modal closes and returns to id-entry after a successful reset',
          ).toBeVisible({ timeout: 15_000 });
        });

        await test.step('the reset was written, and the account signs in with it', async () => {
          const [after] = await db.query<{ password: string }>(
            'SELECT password FROM TBL_KPOST_USER_MASTER WHERE kpost_id = ?',
            [spareId],
          );
          expect(
            String(after?.password) !== hashBefore,
            'the stored password hash changed — the server saved the reset (bcrypt re-salts every save)',
          ).toBe(true);
          await loginPage.login(spareId, password);
          await expect(page, 'the account signs in with the reset password').toHaveURL(/\/home/, {
            timeout: 20_000,
          });
        });

        await test.step('the used code cannot be used again (RTM-SEC03)', async () => {
          // Replays of what the reset just did, with the SAME code — no new SMS. Sent straight to the
          // API (the engine blocks this endpoint): the update re-sets the SAME password, so even if
          // the server wrongly accepts it, the account is left exactly as it is.
          const api = suiteFor('kpost-api').baseUrl;
          const replayed = await request.post(`${api}/v2/common/validateOTP/`, {
            data: {
              otp,
              countryID: Number(user?.country_id),
              mobileNumber: mobile,
              sendDate: Date.now(),
            },
          });
          const replayBody = (await replayed.json().catch(() => ({}))) as { status?: string };
          const again = await request.post(`${api}/v2/common/forgotPasswordUpdate/`, {
            data: { kpostID: spareId, forgotPassword: password },
          });
          const againBody = (await again.json().catch(() => ({}))) as { status?: string };
          test.info().annotations.push({
            type: 'observed',
            description:
              `replay → validateOTP HTTP ${replayed.status()} ${replayBody.status}; ` +
              `forgotPasswordUpdate HTTP ${again.status()} ${againBody.status}`,
          });
          expect(
            replayed.ok() && /success/i.test(String(replayBody.status)),
            `validating the used code again is refused (got HTTP ${replayed.status()} ${replayBody.status})`,
          ).toBe(false);
          expect(
            again.ok() && /success/i.test(String(againBody.status)),
            `setting the password again without a new code is refused — #13207 (got HTTP ${again.status()} ${againBody.status})`,
          ).toBe(false);
        });
      },
    );
  },
);
