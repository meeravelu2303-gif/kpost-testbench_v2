import { env } from '@config/env';
import { STORAGE_STATE_2 } from '@config/constants';
import { testData } from '@config/test-data.config';
import { expect, test as setup } from '@fixtures';

/**
 * Logs in as the **2nd QA account** and saves its session to `.auth/user2.json`, for the two-session
 * Katchup tests (a sender + a receiver, needed for recipient actions and read receipts).
 *
 * Only performs the real login when the two-session suite will actually run
 * (`KATCHUP_UI_LIFECYCLE=true`) — otherwise it saves an anonymous state, so a normal browser run does
 * not do a second fresh login (which would hit the throttling country-list endpoint again).
 */
setup('authenticate second account', async ({ page, loginPage, log }) => {
  const wanted = env.KATCHUP_UI_LIFECYCLE;
  const configured = testData.victimKpostId && !testData.victimKpostId.includes('qa.bench');

  if (wanted && configured) {
    await loginPage.goto();
    await loginPage.login(testData.victimKpostId, testData.password);
    await expect(page, 'second-account login should reach the app').toHaveURL(/\/home/, {
      timeout: 20_000,
    });
    log.info(`Authenticated 2nd account ${testData.victimKpostId}, saving user2 storage state`);
  } else {
    log.info('two-session suite not requested; saving anonymous user2 state');
  }

  await page.context().storageState({ path: STORAGE_STATE_2 });
});
