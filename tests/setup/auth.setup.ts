import { STORAGE_STATE } from '@config/constants';
import { testData } from '@config/test-data.config';
import { expect, test as setup } from '@fixtures';

/**
 * Logs in once through the real login screen and saves the session for every browser project.
 *
 * KPost stores its tokens in `localStorage` (not cookies), which Playwright's `storageState`
 * captures per origin — so the UI tests reuse this session without logging in again. With no real
 * account configured (a mock or unconfigured run) an anonymous state is saved and the UI tests
 * self-skip.
 */
setup('authenticate', async ({ page, loginPage, log }) => {
  const configured = testData.kpostId && !testData.kpostId.includes('qa.bench');

  if (configured) {
    await loginPage.goto();
    await loginPage.login(testData.kpostId, testData.password);
    // A successful login leaves /login for /home.
    await expect(page, 'login should reach the app').toHaveURL(/\/home/, { timeout: 20_000 });
    log.info(`Authenticated as ${testData.kpostId}, saving storage state`);
  } else {
    log.warn('no real QA account configured, saving anonymous storage state');
  }

  await page.context().storageState({ path: STORAGE_STATE });
});
