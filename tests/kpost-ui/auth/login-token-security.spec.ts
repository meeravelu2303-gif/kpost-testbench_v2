import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { settleFrames } from '../support/settle';

/**
 * The access token issued after a real login (stored in localStorage `accessToken`): a well-formed
 * JWT with a bounded expiry.
 */
test.describe(
  'KPost login · issued-token inspection',
  {
    tag: ['@ui', '@auth', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    test(
      'the issued access token is a well-formed JWT with a bounded expiry @ui',
      { annotation: [{ type: 'requirement', description: 'BR-SL-JWT' }] },
      async ({ page }) => {
        await page.goto('/home', { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await page
          .locator('.loader-overlay')
          .waitFor({ state: 'hidden', timeout: 30_000 })
          .catch(() => undefined);

        const token = await page.evaluate(() => localStorage.getItem('accessToken'));
        expect(
          token,
          'an authenticated session must store a top-level accessToken in localStorage',
        ).toBeTruthy();

        const parts = (token ?? '').split('.');
        expect(
          parts,
          'a JWT has exactly three dot-separated parts (header.payload.signature)',
        ).toHaveLength(3);

        const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as {
          exp?: number;
          iat?: number;
        };

        test.info().annotations.push({
          type: 'observed',
          description: `token payload claims: ${JSON.stringify(payload)}`,
        });

        expect(
          payload.exp,
          'the token must carry an expiry (exp) claim — an unbounded token never expires',
        ).toBeDefined();

        const nowSeconds = Date.now() / 1000;
        expect(payload.exp!, 'the token must not already be expired').toBeGreaterThan(nowSeconds);

        // A generous bound against an effectively unbounded token, not a view on the right length.
        const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;
        expect(
          payload.exp! - nowSeconds,
          `the token's remaining lifetime (${Math.round((payload.exp! - nowSeconds) / 86400)} days) exceeds a ` +
            '30-day sanity bound — an access token this long-lived is effectively unbounded',
        ).toBeLessThan(THIRTY_DAYS_SECONDS);
      },
    );
  },
);

/**
 * Logout must invalidate the session on the server, not just clear localStorage. It logs the shared
 * account out, so it has its own SESSION_INVALIDATION_CHECK gate and runs in isolation; re-run `setup`
 * afterwards.
 */
test.describe(
  'KPost login · session invalidation on logout',
  {
    tag: ['@ui', '@auth', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test.skip(
      process.env.SESSION_INVALIDATION_CHECK !== 'true',
      'logs the shared account out and invalidates the saved session; set SESSION_INVALIDATION_CHECK=true and run in isolation',
    );
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    test(
      'a session token stops working after logout (server-side invalidation) @ui',
      { annotation: [{ type: 'requirement', description: 'BR-SL-LOGOUT' }] },
      async ({ loginPage, page }) => {
        // 1. Fresh login, so we hold a genuinely valid session.
        await loginPage.goto();
        await loginPage.login(testData.kpostId, testData.password);
        await expect(page, 'the account is signed in').toHaveURL(/\/home/, { timeout: 20_000 });

        // 2. Snapshot localStorage: what a stolen session would still hold after logout.
        const snapshot = await page.evaluate(() => {
          const out: Record<string, string> = {};
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key) out[key] = localStorage.getItem(key) ?? '';
          }
          return out;
        });
        expect(snapshot.accessToken, 'the signed-in session holds an accessToken').toBeTruthy();

        // 3. Log out through the UI.
        await page.locator('.header-user-pill').first().click();
        await page
          .getByText(/^Log ?out$/i)
          .first()
          .click()
          .catch(() => undefined);
        await page
          .getByRole('button', { name: /^Logout$/i })
          .first()
          .click();
        await expect(page, 'logout returned to the login screen').toHaveURL(/\/login/, {
          timeout: 20_000,
        });

        // 4. Re-plant the pre-logout session and try to walk straight back into an authed screen.
        await page.evaluate((snap) => {
          for (const [key, value] of Object.entries(snap)) localStorage.setItem(key, value);
        }, snapshot);
        await page.goto('/home', { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await settleFrames(page).catch(() => undefined);

        // 5. The server must reject the logged-out token, bouncing the app back to /login.
        await expect(
          page,
          'the pre-logout token must stop working after logout — the app returns to /login',
        ).toHaveURL(/\/login/, { timeout: 20_000 });
      },
    );
  },
);
