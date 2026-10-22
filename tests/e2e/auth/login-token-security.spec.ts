import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { settleFrames } from '../support/settle';

/**
 * Inspects the actual token the app issues after a real login — the piece of Login's security
 * coverage `login-security.spec.ts` (signed-out field fuzzing) never touches, since it needs a real
 * authenticated session to exist first.
 *
 * Confirmed from a direct live inspection of a saved session (not assumed from source alone): the
 * access token is NOT an HttpOnly cookie — it is stored in plain `localStorage` under its OWN
 * top-level key, `accessToken` (a SEPARATE key from `Authuser`, which holds profile fields like
 * kpostID/firstName/userType but carries no token itself). That is itself worth stating plainly
 * rather than assuming: any XSS anywhere on an authenticated page can read it directly
 * (`localStorage.getItem('accessToken')`), no cookie-jar bypass needed. This is the same underlying
 * exposure #808 already covers via the `/profile` debug-page route — this file checks a different
 * angle: whether the token itself is well-formed and time-bounded, not just where it's stored.
 * Live-confirmed token lifetime: 24 hours (iat/exp 86400s apart) — well inside this test's own
 * 30-day sanity bound.
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

        // A generous upper bound, not a tight one: this is a sanity check against an effectively
        // unbounded token (e.g. a 10-year expiry, which is expiry-in-name-only), not an opinion about
        // the exact right session length for this product.
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
 * Session invalidation on LOGOUT (FRD row 16, "Security: sessions") — the one session check the rest of
 * the session coverage stops short of. `login-session.spec.ts` proves an ABSENT session is bounced to
 * `/login`; this proves a session that WAS valid is dead on the server AFTER logout — i.e. logout is a
 * real server-side invalidation, not just a client-side `localStorage` wipe. (The sibling gap,
 * password-reset OTP re-use, is NOT automatable here: the OTP test gateway accepts a fixed BYPASS code
 * by design, so one-time-use can't be exercised without a real SMS we can't receive.)
 *
 * ## Why its OWN gate, not LOGIN_UI_LIFECYCLE
 *
 * This logs the shared QA account OUT, which invalidates the saved `.auth/user.json` session every
 * other UI spec logs in with. So it must NOT ride along on a normal `ui` run (which sets
 * LOGIN_UI_LIFECYCLE). It is gated behind its own `SESSION_INVALIDATION_CHECK=true` flag and run in
 * isolation via `npm run test:session-invalidation`. RE-RUN `setup` afterwards to restore the saved
 * session for the rest of the suite.
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

        // 2. Snapshot the full authenticated localStorage — exactly what a stolen-session attacker
        //    (or a shared/forgotten machine) would still hold after the real user logs out.
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

        // 5. Correct behaviour: the server rejects the logged-out token, so the app bounces back to
        //    /login. If it instead settles on an authenticated /home, the pre-logout token still works
        //    — logout only cleared the client, the server never invalidated the session. That is the
        //    finding, and this assertion surfaces it.
        await expect(
          page,
          'the pre-logout token must stop working after logout — the app returns to /login',
        ).toHaveURL(/\/login/, { timeout: 20_000 });
      },
    );
  },
);
