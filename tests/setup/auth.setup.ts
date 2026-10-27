import { STORAGE_STATE } from '@config/constants';
import { testData } from '@config/test-data.config';
import { expect, test as setup } from '@fixtures';
import { reuseValidSession, saveLogin } from './session-reuse';

/**
 * Logs in once through the real login screen and saves the session (tokens live in localStorage)
 * for every browser project. With no real account configured, an anonymous state is saved.
 */
setup('authenticate', async ({ page, browser, loginPage, log }) => {
  if (await reuseValidSession(browser, STORAGE_STATE, log)) setup.skip();
  const configured = testData.kpostId && !testData.kpostId.includes('qa.bench');

  await saveLogin(
    page,
    STORAGE_STATE,
    'The primary account',
    async () => {
      if (!configured) {
        log.warn('no real QA account configured, saving anonymous storage state');
        return;
      }
      await loginPage.goto();
      await loginPage.login(testData.kpostId, testData.password);
      // A successful login leaves /login for /home.
      await expect(page, 'login should reach the app').toHaveURL(/\/home/, { timeout: 20_000 });
      log.info(`Authenticated as ${testData.kpostId}, saving storage state`);
    },
    log,
  );
});
