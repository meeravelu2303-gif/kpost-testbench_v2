import type { Page } from '@playwright/test';

/**
 * Stub the forgot-password SMS requests in the browser (with the server's success body), so a test can
 * open the reset dialog without sending a real SMS. Only the lifecycle spec sends the one real SMS per run.
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
