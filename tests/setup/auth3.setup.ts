import { env } from '@config/env';
import { STORAGE_STATE_3 } from '@config/constants';
import { testData } from '@config/test-data.config';
import { expect, test as setup } from '@fixtures';

/**
 * Logs in as the **3rd QA account** and saves its session to `.auth/user3.json`, for the Cc /
 * Confidential-Copy (NFR-SEC02) / bulk tests (a sender, a TO recipient, and a Copy / Confidential /
 * additional recipient — three views of one message).
 *
 * Like `auth2.setup.ts`, it only performs the real login when the multi-account suite will run
 * (`KATCHUP_UI_LIFECYCLE=true`); otherwise it saves an anonymous state so a normal run does not do a
 * third fresh login.
 */
setup('authenticate third account', async ({ page, loginPage, log }) => {
  const wanted = env.KATCHUP_UI_LIFECYCLE;
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
