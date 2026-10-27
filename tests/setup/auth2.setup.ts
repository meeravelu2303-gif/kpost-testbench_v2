import { STORAGE_STATE_2 } from '@config/constants';
import { testData } from '@config/test-data.config';
import { expect, test as setup } from '@fixtures';
import { reuseValidSession } from './session-reuse';

/**
 * Logs in as the 2nd QA account and saves the session, for the two-session Katchup tests (sender
 * and receiver). Without KATCHUP_UI_LIFECYCLE=true it saves an anonymous state, avoiding an extra login.
 */
setup('authenticate second account', async ({ page, browser, loginPage, log }) => {
  if (await reuseValidSession(browser, STORAGE_STATE_2, log)) setup.skip();
  const wanted = process.env.KATCHUP_UI_LIFECYCLE === 'true';
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
