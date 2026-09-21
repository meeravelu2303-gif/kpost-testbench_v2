import { testData } from '@config/test-data.config';
import { text } from '@database/kpost-assertions';
import { KpostRepository } from '@database/repositories/kpost.repository';
import { expect, test } from '@fixtures';

/**
 * One user journey asserted at all three layers: **UI → API → MySQL**.
 *
 * ## Why login is the right journey to prove this on
 *
 * A login is the only interaction where the three layers can disagree in a way that matters and is
 * invisible from any one of them:
 *
 *  - The **UI** can land on `/home` — the user believes they are signed in.
 *  - The **API** can have issued a token — the client will happily send it.
 *  - And `TBL_KPOST_LOGIN_SESSION` can still hold no row, which means the server has no record of
 *    the session and therefore **cannot revoke it**. "Log out from all devices" then silently does
 *    nothing, and no UI test or API test would ever notice.
 *
 * That is the whole argument for cross-layer assertions: the defect lives in the gap between the
 * layers, so it can only be seen by a test that spans them.
 *
 * ## What this deliberately does not do
 *
 * It does not write to the database, and it does not assert an exact session count. Other people
 * and other suites use these QA accounts, so "exactly one session" is not a property this test can
 * own. It asserts the only thing that is genuinely attributable: a session row for THIS account
 * exists after the UI login, and every row it sees belongs to the account that just signed in.
 *
 * Failure diagnostics — screenshot, video and trace — come from `playwright.config.ts`
 * (`screenshot: 'only-on-failure'`, `video: 'retain-on-failure'`, `trace: 'retain-on-failure'`),
 * so a failure here arrives at Bugzilla with the reproduction attached.
 */
test.describe('Cross-layer · UI login reaches the database', { tag: '@ui' }, () => {
  // A real login, so the saved session must not short-circuit it.
  test.use({ storageState: { cookies: [], origins: [] } });

  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  test('signing in through the UI creates a revocable session row in MySQL @ui', async ({
    loginPage,
    page,
    databases,
  }) => {
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
    await loginPage.login(testData.kpostId, testData.password);

    /*
     * Landing on an authenticated route is the UI's claim that the login worked. Asserted first so
     * that a failure here is reported as a login/UI problem rather than as a missing database row —
     * which is a different ticket for a different developer.
     */
    await expect(page, 'a successful login leaves the login screen').not.toHaveURL(/\/login/, {
      timeout: 30_000,
    });

    // --- Layer 2: the client now holds a token --------------------------------------------------
    const token = await page.evaluate(() => window.localStorage.getItem('accessToken'));
    expect(token, 'the app stored an access token for the signed-in user').toBeTruthy();

    // --- Layer 3, after: the server can actually revoke that session -----------------------------
    /*
     * Polled rather than read once: the session row is written by the login request, which the SPA
     * fires as it navigates, so a single immediate read races the server's own commit and would
     * report a missing row that appears milliseconds later. `expect.poll` waits for the state
     * instead of asserting a snapshot.
     */
    await expect
      .poll(async () => (await repo.sessions(testData.kpostId)).length, {
        message:
          'a token was issued and the UI is signed in, but TBL_KPOST_LOGIN_SESSION holds no row ' +
          'for this account — the server cannot revoke a session it has no record of',
        timeout: 20_000,
      })
      .toBeGreaterThan(0);

    const after = await repo.sessions(testData.kpostId);

    // Every row must belong to the account that signed in: a session attributed to somebody else
    // is a far more serious fault than a missing one.
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
  });
});
