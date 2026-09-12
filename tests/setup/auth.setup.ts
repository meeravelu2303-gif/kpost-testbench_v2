import { STORAGE_STATE } from '@config/constants';
import { env } from '@config/env';
import { expect, test as setup } from '@fixtures';

/**
 * Logs in once and saves the session for all UI projects.
 * Without credentials an anonymous state is saved, so the suite still runs.
 */
setup('authenticate', async ({ page, loginPage, log }) => {
  const { APP_USERNAME, APP_PASSWORD } = env;

  if (APP_USERNAME && APP_PASSWORD) {
    await loginPage.goto();
    await loginPage.login(APP_USERNAME, APP_PASSWORD);
    await expect(page).not.toHaveURL(new RegExp(loginPage.path));
    log.info('Authenticated, saving storage state');
  } else {
    log.warn('APP_USERNAME / APP_PASSWORD not set, saving anonymous storage state');
  }

  await page.context().storageState({ path: STORAGE_STATE });
});
