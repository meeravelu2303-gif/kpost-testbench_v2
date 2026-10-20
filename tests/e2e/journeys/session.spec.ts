import { STORAGE_STATE, TAGS } from '@config/constants';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { gotoKatchup } from '../support/katchup';
import {
  logoutFromUi,
  requireAccounts,
  requireFlags,
  restoreSavedSession,
} from './support/journey';

/**
 * JOURNEY 7 · SIGNING OUT AND BACK IN — a user ends their session and starts a new one.
 *
 * A is working (Katchup open) → logs out through the header menu → every protected screen now sends
 * them to the login screen → the browser's Back button does not bring a protected screen back →
 * A signs in again through the real login screen → lands on Home → their screens work again.
 *
 * Logging out ends A's session on the server, which is the session `.auth/user.json` holds
 * (`login-token-security.spec.ts`). The journey's last step signs A in again and re-saves that file,
 * so the rest of the run keeps a live session — the same end state a real user is in.
 */
const PROTECTED = ['/katchup', '/kmail', '/kall', '/settings', '/userprofile'] as const;

test.describe(
  'JOURNEY 7 · signing out and back in',
  { tag: [TAGS.ui, TAGS.journey, TAGS.auth, TAGS.regression] },
  () => {
    test.describe.configure({ timeout: 180_000 });
    requireAccounts('A');
    requireFlags('LOGIN_UI_LIFECYCLE');

    test(
      'A logs out, protected screens refuse them, and A signs back in',
      { tag: '@sanity' },
      async ({ page }) => {
        let loggedOut = false;
        try {
          await test.step('A is working in Katchup', async () => {
            await gotoKatchup(page);
            await expect(page, 'A is signed in on Katchup').toHaveURL(/\/katchup/);
          });

          await test.step('A logs out', async () => {
            await logoutFromUi(page);
            loggedOut = true;
          });

          for (const route of PROTECTED)
            await test.step(`${route} sends a signed-out user to login`, async () => {
              await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 45_000 });
              await expect(page, `${route} redirects to /login after logout`).toHaveURL(/\/login/, {
                timeout: 20_000,
              });
            });

          await test.step('Back does not bring a protected screen back', async () => {
            await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => undefined);
            await expect(page, 'still on the login screen after Back').toHaveURL(/\/login/, {
              timeout: 20_000,
            });
          });

          await test.step('A signs in again and the screens work', async () => {
            await restoreSavedSession(page, testData.kpostId, testData.password, STORAGE_STATE);
            loggedOut = false;
            await gotoKatchup(page);
            await expect(page, 'Katchup opens again after signing back in').toHaveURL(/\/katchup/);
          });
        } finally {
          // Never leave the shared session dead, even if a step above failed.
          if (loggedOut)
            await restoreSavedSession(
              page,
              testData.kpostId,
              testData.password,
              STORAGE_STATE,
            ).catch(() => undefined);
        }
      },
    );
  },
);
