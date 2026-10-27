import { STORAGE_STATE_BUSINESS } from '@config/constants';
import { testData } from '@config/test-data.config';
import { expect, test as setup } from '@fixtures';
import { reuseValidSession } from './session-reuse';

/**
 * Logs in as the BUSINESS_S company admin and saves the session, for the User Management UI.
 * Without BUSINESS_UI_LIFECYCLE=true it saves an anonymous state, avoiding an extra login.
 */
setup('authenticate BUSINESS_S admin', async ({ page, browser, loginPage, log }) => {
  if (await reuseValidSession(browser, STORAGE_STATE_BUSINESS, log)) setup.skip();
  const wanted = process.env.BUSINESS_UI_LIFECYCLE === 'true';
  const configured =
    testData.businessSKpostId && !testData.businessSKpostId.includes('qa.business');

  if (wanted && configured) {
    await loginPage.goto();
    // The business tiers' own password: under QATEST_ONLY `testData.password` is the shared qatest one.
    await loginPage.login(
      testData.businessSKpostId,
      testData.businessPassword ?? testData.password,
    );
    await expect(page, 'BUSINESS_S admin login should reach the app').toHaveURL(/\/home/, {
      timeout: 25_000,
    });
    log.info(`Authenticated BUSINESS_S admin ${testData.businessSKpostId}, saving business state`);
  } else {
    log.info('company-admin UI suite not requested; saving anonymous business state');
  }

  await page.context().storageState({ path: STORAGE_STATE_BUSINESS });
});
