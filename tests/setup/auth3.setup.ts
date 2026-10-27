import { STORAGE_STATE_3 } from '@config/constants';
import { testData } from '@config/test-data.config';
import { expect, test as setup } from '@fixtures';
import { reuseValidSession } from './session-reuse';

/**
 * Logs in as the 3rd QA account and saves the session, for the Cc / confidential-copy tests (three
 * views of one message). Without KATCHUP_UI_LIFECYCLE=true it saves an anonymous state.
 */
setup('authenticate third account', async ({ page, browser, loginPage, log }) => {
  if (await reuseValidSession(browser, STORAGE_STATE_3, log)) setup.skip();
  const wanted = process.env.KATCHUP_UI_LIFECYCLE === 'true';
  const configured = testData.personal3KpostId && !testData.personal3KpostId.includes('qa.p3');

  if (wanted && configured) {
    await loginPage.goto();
    await loginPage.login(testData.personal3KpostId, testData.password);
    await expect(page, 'third-account login should reach the app').toHaveURL(/\/home/, {
      timeout: 20_000,
    });
    log.info(`Authenticated 3rd account ${testData.personal3KpostId}, saving user3 storage state`);
  } else {
    log.info('multi-account suite not requested; saving anonymous user3 state');
  }

  await page.context().storageState({ path: STORAGE_STATE_3 });
});
