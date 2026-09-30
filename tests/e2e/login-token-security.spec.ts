import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Inspects the actual token the app issues after a real login — the piece of Login's security
 * coverage `login-security.spec.ts` (signed-out field fuzzing) never touches, since it needs a real
 * authenticated session to exist first.
 *
 * Confirmed from source (`Login.js`): the access token is NOT an HttpOnly cookie — it is stored in
 * plain `localStorage` under the key `Authuser` (`{ accessToken, ... }`, `JSON.stringify`'d). That is
 * itself worth stating plainly rather than assuming: any XSS anywhere on an authenticated page can
 * read it directly (`localStorage.getItem('Authuser')`), no cookie-jar bypass needed. This is the
 * same underlying exposure #808 already covers via the `/profile` debug-page route — this file checks
 * a different angle: whether the token itself is well-formed and time-bounded, not just where it's
 * stored.
 */
test.describe('KPost login · issued-token inspection', { tag: '@ui' }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  test('the issued access token is a well-formed JWT with a bounded expiry @ui', async ({ page }) => {
    await page.goto('/home', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page
      .locator('.loader-overlay')
      .waitFor({ state: 'hidden', timeout: 30_000 })
      .catch(() => undefined);

    const authUserRaw = await page.evaluate(() => localStorage.getItem('Authuser'));
    expect(authUserRaw, 'an authenticated session must have an Authuser entry in localStorage').not.toBeNull();

    const authUser = JSON.parse(authUserRaw ?? '{}') as { accessToken?: string };
    const token = authUser.accessToken;
    expect(token, 'the stored Authuser object must carry an accessToken').toBeTruthy();

    const parts = (token ?? '').split('.');
    expect(parts, 'a JWT has exactly three dot-separated parts (header.payload.signature)').toHaveLength(3);

    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as {
      exp?: number;
      iat?: number;
    };

    test.info().annotations.push({
      type: 'observed',
      description: `token payload claims: ${JSON.stringify(payload)}`,
    });

    expect(payload.exp, 'the token must carry an expiry (exp) claim — an unbounded token never expires').toBeDefined();

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
  });
});
