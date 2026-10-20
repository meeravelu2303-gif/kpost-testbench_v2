import type { Page } from '@playwright/test';

/**
 * Answer the forgot-password SMS requests IN THE BROWSER, so a test can open the reset dialog
 * without texting anyone.
 *
 * Clicking "Forgot Password ?" alone sends a real SMS (Login.js `handleForgetPassword` →
 * `forgotPasswordOTPOrSentKpostIDSms`), and the server never applies the OTP bypass to it
 * (UserProfileServiceImpl.forgotPassword). Owner rule (2026-10-20): one forgot-password SMS per run,
 * sent only by `login-forgot-password-lifecycle.spec.ts`. Every other test that opens the dialog
 * calls this first. The reply mirrors the server's own success body, so the dialog opens exactly as
 * it would; the request itself never leaves the browser.
 */
export async function answerForgotPasswordSmsLocally(page: Page): Promise<void> {
  await page.route(/\/forgotPasswordOTPOrSentKpostIDSms|\/forgotPasswordOrKpostID/i, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        statusCode: 200,
        status: 'SUCCESS',
        message: ' OTP Sent to your registered mobile number',
        mobileNumber: '9000000000',
        countryID: 1,
        urlPath: '/forgotPWDorIDorAccessCode/',
      }),
    }),
  );
}
