import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Does the Home dashboard actually surface a failing API response, or does it silently show an
 * empty list? Confirmed from source (`Services/Katchup.js`'s `RecentMessageService`): the Recents
 * tab's content is loaded from `POST /dashboard/katchupDashboardMsg/`. This stubs that ONE call to
 * fail — every other call the screen makes goes through normally — and checks for the same
 * silent-failure pattern already confirmed on Signup/Login (#821-824, #832): a rejected call that
 * produces no visible error is indistinguishable, to a real user, from "you have no messages" or
 * "the page is broken."
 */
test.describe('KPost Home · dashboard API failure handling', { tag: '@ui' }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  test('a failing Recents dashboard load shows an error, not a false-empty list @ui', async ({
    homePage,
    page,
  }) => {
    await page.route('**/dashboard/katchupDashboardMsg/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        // KPost's envelope anti-pattern (HTTP 200 carrying a failure) — the shape confirmed
        // faithfully elsewhere in this suite (e.g. `login-functional.spec.ts`).
        body: JSON.stringify({ statusCode: 500, status: 'FAILURE', message: 'Internal Server Error' }),
      });
    });

    await homePage.goto();
    await homePage.switchToRecentsTab();
    await page.waitForTimeout(2_000);

    const anyErrorToast = page.locator('.Toastify__toast, [class*="toast"]', {
      hasText: /error|fail|try again|something went wrong/i,
    });
    const errorVisible = await anyErrorToast.first().isVisible().catch(() => false);

    test.info().annotations.push({
      type: 'observed',
      description: errorVisible
        ? 'an error toast was shown'
        : 'no visible error of any kind — the dashboard load failed silently',
    });

    expect(
      errorVisible,
      'a failed dashboard-load call must show SOME visible feedback — otherwise a real outage is ' +
        'indistinguishable from "this account genuinely has zero messages"',
    ).toBe(true);
  });
});
