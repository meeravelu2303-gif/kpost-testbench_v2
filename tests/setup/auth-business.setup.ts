import { env } from '@config/env';
import { STORAGE_STATE_BUSINESS } from '@config/constants';
import { testData } from '@config/test-data.config';
import { expect, test as setup } from '@fixtures';

/**
 * Logs in as the **BUSINESS_S company admin** (`sma.qa@kpost.in`) and saves its session to
 * `.auth/business.json`, for the company-admin UI on the main KPost app — the **User Management**
 * screen a business admin has (`/usermanagement`), which a PERSONAL account does not.
 *
 * Only performs the real login when a company-admin UI spec will run (`BUSINESS_UI_LIFECYCLE=true`);
 * otherwise it saves an anonymous state so a normal browser run does not do an extra fresh login
 * (which re-hits the throttling country-list endpoint).
 */
setup('authenticate BUSINESS_S admin', async ({ page, loginPage, log }) => {
  const wanted = env.BUSINESS_UI_LIFECYCLE;
  const configured =
    testData.businessSKpostId && !testData.businessSKpostId.includes('qa.business');

  if (wanted && configured) {
    await loginPage.goto();
    await loginPage.login(testData.businessSKpostId, testData.password);
    await expect(page, 'BUSINESS_S admin login should reach the app').toHaveURL(/\/home/, {
      timeout: 25_000,
    });
    log.info(`Authenticated BUSINESS_S admin ${testData.businessSKpostId}, saving business state`);
  } else {
    log.info('company-admin UI suite not requested; saving anonymous business state');
  }

  await page.context().storageState({ path: STORAGE_STATE_BUSINESS });
});
