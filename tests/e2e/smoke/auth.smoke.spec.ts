import { TAGS } from '@config/constants';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { logoutFromUi, signInFromUi } from '../journeys/support/journey';

/**
 * UI SMOKE · Signup & Login — a real person can sign in through the login screen and sign out again.
 *
 * Runs as the spare account qatest5 in a fresh, signed-out browser: KPost keeps one session per
 * account, so signing in as qatest1–3 here would sign out the saved sessions every other UI test uses.
 * qatest6 is reserved for the password-reset test, which changes its password.
 */
test.describe(
  'SMOKE · UI · Signup & Login',
  { tag: [TAGS.ui, TAGS.auth, TAGS.smoke, TAGS.sanity, TAGS.regression] },
  () => {
    test.use({ storageState: { cookies: [], origins: [] } });
    test.skip(
      !testData.personal5KpostId || testData.personal5KpostId.includes('qa.p5'),
      'needs the spare QA account (QA_PERSONAL_5_KPOST_ID)',
    );

    test('a user signs in through the login screen, lands on Home, and signs out', async ({
      page,
    }) => {
      await signInFromUi(page, testData.personal5KpostId, testData.password);
      await expect(
        page.locator('.header-user-name, .header-user-pill').first(),
        'the signed-in header shows the user',
      ).toBeVisible({ timeout: 20_000 });
      await logoutFromUi(page);
    });
  },
);
