import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * /profile (not /userprofile): a leftover debug page that renders the access token and secret key as
 * page text. The token must not appear in the visible page.
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
      // localStorage is per origin, so read it only after navigating to the app. The token is under
      // `accessToken`; `Authuser` is the profile.
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

      expect(
        tokenExposed,
        '/profile must never render the real access token as plain, screenshot-able page text — ' +
          'confirmed from source (dashboard/Profile.js) that it currently does',
      ).toBe(false);
    });
  },
);
