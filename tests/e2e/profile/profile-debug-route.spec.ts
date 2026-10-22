import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * `/profile` — NOT the same route as `/userprofile` (`UserProfile.js`, fully covered elsewhere).
 * Confirmed from source: `dashboard/Profile.js` is a 20-line leftover debug page that renders
 *
 *   <p>Access token: {String(userAccToken(CredsValues))}</p>
 *   <p>Secret Key: {String(LocalSecretKeys)}</p>
 *
 * directly as visible page text. Its route guard in `MenuRoutes.js` (`user !== ""`) is looser than
 * the `user.user` truthy check every other authenticated route uses, and it carries no distinct
 * purpose beyond what `/userprofile` already covers properly.
 *
 * This is a genuine security-exposure concern, not a coverage-for-coverage's-sake target: a real
 * access token rendered as plain DOM text is screenshot-able, cacheable, and readable by anything
 * with page access (an extension, a shared screen, a scraped page). This test exists to CONFIRM the
 * exposure live (source can drift from deployment) — a passing "token is visible" assertion here is
 * itself the finding to file, not a state to celebrate.
 */
test.describe(
  'KPost — /profile debug route (real access token exposure)',
  { tag: ['@ui', '@profile', '@regression'] },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    test('visiting /profile must not render the real access token as plain visible text @ui', async ({
      page,
    }) => {
      // localStorage belongs to the app's origin, so read it only after navigating there (reading it
      // on about:blank — what this test did until 2026-10-11 — always came back empty and skipped).
      // The session keeps the token under the top-level `accessToken` key; `Authuser` is the profile.
      await page.goto('/profile', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      const realToken = await page.evaluate(() => {
        try {
          const direct = localStorage.getItem('accessToken');
          if (direct && direct.length > 20) return direct.replace(/^"|"$/g, '');
          const raw = localStorage.getItem('Authuser');
          const parsed = raw ? (JSON.parse(raw) as { accessToken?: unknown }) : undefined;
          return typeof parsed?.accessToken === 'string' ? parsed.accessToken : '';
        } catch {
          return '';
        }
      });
      expect(realToken, 'the signed-in session holds an access token to compare against').not.toBe(
        '',
      );

      const bodyText = (await page.locator('body').textContent()) ?? '';
      const tokenExposed = bodyText.includes(realToken);

      test.info().annotations.push({
        type: 'observed',
        description: `token exposed as literal page text: ${tokenExposed}`,
      });

      // Predicted from source to FAIL: dashboard/Profile.js renders `userAccToken(CredsValues)` as
      // plain page text. A failure here on the live build is the evidence needed to file this as a
      // real access-token exposure, not something to assume without confirming against deployment.
      expect(
        tokenExposed,
        '/profile must never render the real access token as plain, screenshot-able page text — ' +
          'confirmed from source (dashboard/Profile.js) that it currently does',
      ).toBe(false);
    });
  },
);
