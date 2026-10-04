import { testData } from '@config/test-data.config';
import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';

/**
 * `/profile-webview/:id` (`ProfileWebView.js`) — a PUBLIC, read-only shareable profile card, no auth
 * required. Confirmed from source: it calls the genuinely public `POST /v2/profile/shareUserDetails/`
 * (Authorization header commented out) and, on a non-SUCCESS response — the expected outcome for a
 * malformed/stranger id — cleanly `navigate("/not-found")`, no crash. This is the CORRECT behavior to
 * assert directly, matching the source's own confirmed handling.
 */
test.describe('KPost — /profile-webview/:id public profile card', { tag: '@ui' }, () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('an invalid/unknown id redirects cleanly to /not-found, without crashing @ui', async ({
    page,
  }) => {
    const stop = watchUiHealth(page);
    await page.goto('/profile-webview/definitely-not-a-real-id', {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    });
    await page.waitForTimeout(2_000);

    const health = stop();
    expect(health.pageErrors, 'no uncaught JS error on an invalid id').toEqual([]);
    await expect(page, 'an unresolvable id redirects to the not-found route').toHaveURL(/not-found/);
  });

  /**
   * The valid-id case, never previously covered: does the public card actually render for a real
   * account, and — since this screen is reachable with NO login and NO Authorization header — does
   * the backend's own `shareUserDetails` response mask sensitive fields itself, rather than relying on
   * the frontend's purely cosmetic `isMasked()` check (source: ProfileWebView.js's `isMasked = (value)
   * => typeof value === "string" && value.includes("X")` — a display-only heuristic, not a security
   * boundary; a caller hitting the API directly, bypassing this component entirely, would see whatever
   * the backend actually sends).
   *
   * Confirmed live 2026-10-04: the backend DOES mask server-side (`mobileNumber` comes back as
   * "9X9X9X3X5X", `dateOfBirth` as "19XX-04-XX", no password/kmailPassword/accessCode fields at all) —
   * this is correct, secure behavior, not a bug. Note for the record, not filed: the route's `:id` is
   * an AES-encrypted kpostID (`src/utils/Crypto.js`), but the AES key is a hardcoded literal
   * ("your-secret-key") shipped in the public JS bundle — trivially reversible/forgeable by anyone, so
   * the encryption provides no real access control. Low impact in practice since the endpoint already
   * masks every sensitive field for any caller regardless of how the id was obtained, and the card is
   * intentionally public by design — but worth knowing if a real access-control decision is ever added
   * here later, since this "encryption" would not back it up.
   */
  test('a valid id renders the public card, with no unmasked credential fields in the raw response @ui', async ({
    page,
  }) => {
    test.skip(!testData.victimKpostId, 'needs a real live account (QA_VICTIM_KPOST_ID)');

    // The route param is NOT the raw kpostID — ProfileWebView.js decrypts it first
    // (`decryptId(id)`, AES via crypto-js, src/utils/Crypto.js) before using it. Mint a matching
    // encrypted id the same way the app does, via crypto-js loaded live in the page itself (the bench
    // has no crypto-js dependency of its own, and hand-rolling AES/OpenSSL-KDF compatibly is not worth
    // it for one id).
    await page.goto('about:blank');
    await page.addScriptTag({ url: 'https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.2.0/crypto-js.min.js' });
    const encryptedId = await page.evaluate((kpostID) => {
      // @ts-expect-error -- CryptoJS global from the injected script tag above.
      return CryptoJS.AES.encrypt(kpostID, 'your-secret-key').toString();
    }, testData.victimKpostId);

    let shareBody: string | undefined;
    page.on('requestfinished', async (req) => {
      if (req.url().includes('shareUserDetails') && req.method() === 'POST') {
        shareBody = await req.response().then((r) => r?.text()).catch(() => undefined);
      }
    });

    const stop = watchUiHealth(page);
    await page.goto(`/profile-webview/${encodeURIComponent(encryptedId)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    });
    await page.waitForTimeout(3_000);

    const health = stop();
    expect(health.pageErrors, 'no uncaught JS error rendering a real public card').toEqual([]);
    await expect(page, 'a valid id stays on the webview, not redirected away').toHaveURL(/profile-webview/);

    expect(shareBody, 'the shareUserDetails call completed').toBeTruthy();
    if (shareBody) {
      const lower = shareBody.toLowerCase();
      for (const field of ['"password"', '"kmailpassword"', '"accesscode"']) {
        expect(lower, `the public, unauthenticated share response must never include ${field}`).not.toContain(
          field,
        );
      }
    }
  });
});
