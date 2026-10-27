import { STORAGE_STATE } from '@config/constants';
import { testData } from '@config/test-data.config';
import { text } from '@database/kpost-assertions';
import { KpostRepository } from '@database/repositories/kpost.repository';
import { expect, test } from '@fixtures';

/**
 * A UI login asserted at UI, API and MySQL: a token without a TBL_KPOST_LOGIN_SESSION row is a
 * session the server cannot revoke. Read-only; no exact session count (shared QA accounts).
 */
test.describe(
  'Cross-layer · UI login reaches the database @database',
  { tag: ['@ui', '@auth', '@regression'] },
  () => {
    // A real login, so the saved session must not short-circuit it.
    test.use({ storageState: { cookies: [], origins: [] } });

    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    test(
      'signing in through the UI creates a revocable session row in MySQL @ui',
      {
        annotation: [
          {
            type: 'cross-layer',
            description: 'Login: sign in on screen → userLogin → TBL_KPOST_LOGIN_SESSION',
          },
        ],
      },
      async ({ loginPage, page, databases }) => {
        const database = databases.for('kpost-api');
        test.skip(
          !database.enabled,
          'needs the KPOST_QA connection (DB_HOST/DB_NAME) for the database half',
        );
        test.skip(!testData.password, 'needs QA_PASSWORD to drive a real login');

        const repo = new KpostRepository(database);

        // --- Layer 3, before: what the database already knows ---------------------------------------
        const before = await repo.sessions(testData.kpostId);

        // --- Layer 1: the user's actual journey -----------------------------------------------------
        await loginPage.goto();
        // Layer 2: the login request the screen sends, and its answer.
        const loginAnswer = page.waitForResponse(
          (r) => r.url().includes('/signupLogin/userLogin'),
          {
            timeout: 30_000,
          },
        );
        await loginPage.login(testData.kpostId, testData.password);
        expect((await loginAnswer).status(), 'the server accepts the login').toBeLessThan(300);

        // Asserted first so a UI login failure is not reported as a missing database row.
        await expect(page, 'a successful login leaves the login screen').not.toHaveURL(/\/login/, {
          timeout: 30_000,
        });

        // --- Layer 2: the client now holds a token --------------------------------------------------
        const token = await page.evaluate(() => window.localStorage.getItem('accessToken'));
        expect(token, 'the app stored an access token for the signed-in user').toBeTruthy();

        // A fresh login can revoke the shared saved session; re-save it so later specs don't 401.
        await page.context().storageState({ path: STORAGE_STATE });

        // --- Layer 3, after: the server can actually revoke that session -----------------------------
        // Polled: a single immediate read races the server's commit of the session row.
        await expect
          .poll(async () => (await repo.sessions(testData.kpostId)).length, {
            message:
              'a token was issued and the UI is signed in, but TBL_KPOST_LOGIN_SESSION holds no row ' +
              'for this account — the server cannot revoke a session it has no record of',
            timeout: 20_000,
          })
          .toBeGreaterThan(0);

        const after = await repo.sessions(testData.kpostId);

        // Every row must belong to the account that signed in.
        expect(
          after.every((session) => text(session.kpost_id) === testData.kpostId),
          'every session row returned for this account belongs to it',
        ).toBe(true);
        expect(
          after.every((session) => Boolean(session.session_id) && Boolean(session.login_time)),
          'each session carries the id and timestamp a revocation would need',
        ).toBe(true);

        test.info().annotations.push({
          type: 'cross-layer',
          description: `sessions before ${before.length} → after ${after.length} for ${testData.kpostId}`,
        });
      },
    );
  },
);
