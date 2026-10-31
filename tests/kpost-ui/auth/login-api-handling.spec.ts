import type { Page, Route } from '@playwright/test';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import type { LoginPage } from '@pages/LoginPage';
import { toast } from '../support/validation';

/**
 * Login and forgot-password: when a call fails or gets no answer, the screen says so (Login.js). Each
 * failing call is answered or aborted in the browser, and every forgot-password OTP call is answered
 * there too, so no SMS is sent, no OTP is used and no password changes.
 */
const json = (body: object) => (route: Route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

/** The forgot-password OTP request, answered in the browser with the server's success body. */
const SMS_SENT = {
  statusCode: 200,
  status: 'SUCCESS',
  message: ' OTP Sent to your registered mobile number',
  mobileNumber: '9000000000',
  countryID: 1,
  urlPath: '/forgotPWDorIDorAccessCode/',
};
const SEND_OTP = /\/forgotPasswordOTPOrSentKpostIDSms/i;
const VALIDATE_OTP = /\/common\/validateOTP/i;
const UPDATE_PASSWORD = /\/common\/forgotPasswordUpdate/i;

/** Login id → password step → "Forgot Password", with the OTP request answered as given. */
async function openForgotPassword(
  page: Page,
  loginPage: LoginPage,
  answerSend: (route: Route) => Promise<void>,
): Promise<void> {
  await page.route(SEND_OTP, answerSend);
  await loginPage.goto();
  await loginPage.expectLoaded();
  await loginPage.enterLoginId(testData.kpostId);
  await loginPage.passwordInput.waitFor({ state: 'visible', timeout: 20_000 });
  await page
    .getByText(/Forgot Password/i)
    .first()
    .click();
}

/** Types an OTP into the six boxes; the screen verifies it on the sixth digit. */
async function typeOtp(page: Page, otp = '123456'): Promise<void> {
  await page.locator('#input_0').waitFor({ state: 'visible', timeout: 15_000 });
  for (const [index, digit] of otp.split('').entries())
    await page.locator(`#input_${index}`).fill(digit);
}

test.describe(
  'KPost login · a failed sign-in or password reset is reported',
  {
    tag: ['@ui', '@auth', '@regression'],
    annotation: [{ type: 'non-functional', description: 'resilience' }],
  },
  () => {
    test.use({ storageState: { cookies: [], origins: [] } });
    test.skip(!testData.kpostId, 'needs the QA account (QA_KPOST_ID)');

    test('a sign-in that gets no answer says "Unable to sign in"', async ({ loginPage, page }) => {
      await page.route('**/signupLogin/userLogin/**', (route) => route.abort());
      await loginPage.goto();
      await loginPage.expectLoaded();
      await loginPage.enterLoginId(testData.kpostId);
      await loginPage.passwordInput.fill(testData.password || 'placeholder');
      await loginPage.loginButton.click();
      await expect(
        page.getByText('Unable to sign in. Check your connection and try again.'),
        'the user is told the sign-in did not reach the server',
      ).toBeVisible({ timeout: 10_000 });
      await expect(page, 'and stays on the login screen').toHaveURL(/\/login/);
    });

    test('a reset OTP request that gets no answer says "Unable to send OTP"', async ({
      loginPage,
      page,
    }) => {
      await openForgotPassword(page, loginPage, (route) => route.abort());
      await expect(
        toast(page, 'Unable to send OTP. Check your connection and try again.'),
      ).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('#input_0'), 'the OTP boxes do not open').toBeHidden();
    });

    test('a resend that gets no answer says "Unable to resend OTP"', async ({
      loginPage,
      page,
    }) => {
      // Resend unlocks after a 30 s countdown: run the clock forward instead of waiting.
      await page.clock.install();
      let sends = 0;
      await openForgotPassword(page, loginPage, (route) => {
        sends += 1;
        return sends === 1 ? json(SMS_SENT)(route) : route.abort();
      });
      await page.locator('#input_0').waitFor({ state: 'visible', timeout: 15_000 });
      // Each tick is a fresh 1 s timeout set after React re-renders, so step a second at a time.
      const resend = page.locator('span.cursor-pointer').filter({ hasText: /Resend OTP/ });
      for (
        let second = 0;
        second < 32 && (await resend.getAttribute('class'))?.includes('disabled');
        second += 1
      )
        await page.clock.runFor(1_000);
      await expect(resend, 'Resend unlocks after the countdown').not.toHaveClass(/disabled/);
      await resend.click();
      await expect(
        toast(page, 'Unable to resend OTP. Check your connection and try again.'),
      ).toBeVisible({ timeout: 10_000 });
    });

    test('a wrong OTP is refused with "Invalid OTP"', async ({ loginPage, page }) => {
      // The refusal without a message of its own, so the screen's fallback text shows.
      await page.route(VALIDATE_OTP, json({ status: 'FAILURE', statusCode: 400 }));
      await openForgotPassword(page, loginPage, json(SMS_SENT));
      await typeOtp(page);
      await expect(toast(page, 'Invalid OTP. Please enter the correct code')).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.getByText(/^Enter Your New Password$/i), 'no password step').toBeHidden();
    });

    test('an OTP check that gets no answer says "Unable to verify OTP"', async ({
      loginPage,
      page,
    }) => {
      await page.route(VALIDATE_OTP, (route) => route.abort());
      await openForgotPassword(page, loginPage, json(SMS_SENT));
      await typeOtp(page);
      await expect(
        toast(page, 'Unable to verify OTP. Check your connection and try again.'),
      ).toBeVisible({ timeout: 10_000 });
    });

    test('pasting anything but 6 digits into the OTP is refused', async ({ loginPage, page }) => {
      await openForgotPassword(page, loginPage, json(SMS_SENT));
      const first = page.locator('#input_0');
      await first.waitFor({ state: 'visible', timeout: 15_000 });
      await first.evaluate((box) => {
        const data = new DataTransfer();
        data.setData('text', '12a');
        box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
      });
      await expect(toast(page, 'Please Paste the OTP with 6 Digits Only!')).toBeVisible({
        timeout: 10_000,
      });
    });

    test('a new password that gets no answer says "Unable to update password"', async ({
      loginPage,
      page,
    }) => {
      await page.route(
        VALIDATE_OTP,
        json({ status: 'SUCCESS', statusCode: 200, message: 'OTP Verified' }),
      );
      // The password never reaches the server, so it does not change.
      await page.route(UPDATE_PASSWORD, (route) => route.abort());
      await openForgotPassword(page, loginPage, json(SMS_SENT));
      await typeOtp(page);
      await expect(page.getByText(/^Enter Your New Password$/i)).toBeVisible({ timeout: 15_000 });
      await loginPage.submitNewPassword('QaBench@NotSaved1');
      await expect(
        toast(page, 'Unable to update password. Check your connection and try again.'),
      ).toBeVisible({ timeout: 10_000 });
    });
  },
);
