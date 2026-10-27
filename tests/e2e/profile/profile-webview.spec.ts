import { testData } from '@config/test-data.config';
import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';
import { settleFrames, settleNetwork } from '../support/settle';

/**
 * /profile-webview/:id: the public, no-login profile card (POST /v2/profile/shareUserDetails/). An
 * unknown id must redirect to /not-found; a valid id must render without leaking credential fields.
 */
test.describe(
  'KPost — /profile-webview/:id public profile card',
  { tag: ['@ui', '@profile', '@regression'] },
  () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('an invalid/unknown id redirects cleanly to /not-found, without crashing @ui', async ({
      page,
    }) => {
      const stop = watchUiHealth(page);
      await page.goto('/profile-webview/definitely-not-a-real-id', {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
      });
      await expect(page, 'an unresolvable id redirects to the not-found route').toHaveURL(
        /not-found/,
        { timeout: 20_000 },
      );
      await settleFrames(page);

      const health = stop();
      expect(health.pageErrors, 'no uncaught JS error on an invalid id').toEqual([]);
    });

    // The backend must mask sensitive fields itself: the frontend's isMasked() is display-only, and
    // the endpoint needs no login.
    test('a valid id renders the public card, with no unmasked credential fields in the raw response @ui', async ({
      page,
    }) => {
      test.skip(!testData.victimKpostId, 'needs a real live account (QA_VICTIM_KPOST_ID)');

      // The route param is the AES-encrypted kpostID; mint it as the app does, with crypto-js loaded
      // in the page (the bench has no crypto-js dependency).
      await page.goto('about:blank');
      await page.addScriptTag({
        url: 'https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.2.0/crypto-js.min.js',
      });
      const encryptedId = await page.evaluate((kpostID) => {
        // CryptoJS is the global the injected script tag above defines.
        type CryptoJsAes = { AES: { encrypt(plain: string, key: string): { toString(): string } } };
        const { CryptoJS } = globalThis as unknown as { CryptoJS: CryptoJsAes };
        return CryptoJS.AES.encrypt(kpostID, 'your-secret-key').toString();
      }, testData.victimKpostId);

      let shareBody: string | undefined;
      page.on('requestfinished', async (req) => {
        if (req.url().includes('shareUserDetails') && req.method() === 'POST') {
          shareBody = await req
            .response()
            .then((r) => r?.text())
            .catch(() => undefined);
        }
      });

      const stop = watchUiHealth(page);
      const shared = settleNetwork(page, /shareUserDetails/, 20_000);
      await page.goto(`/profile-webview/${encodeURIComponent(encryptedId)}`, {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
      });
      await shared;
      await settleFrames(page);

      const health = stop();
      expect(health.pageErrors, 'no uncaught JS error rendering a real public card').toEqual([]);
      await expect(page, 'a valid id stays on the webview, not redirected away').toHaveURL(
        /profile-webview/,
      );

      expect(shareBody, 'the shareUserDetails call completed').toBeTruthy();
      if (shareBody) {
        const lower = shareBody.toLowerCase();
        for (const field of ['"password"', '"kmailpassword"', '"accesscode"']) {
          expect(
            lower,
            `the public, unauthenticated share response must never include ${field}`,
          ).not.toContain(field);
        }
      }
    });
  },
);
