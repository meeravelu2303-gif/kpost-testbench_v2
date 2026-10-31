import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { toast } from '../support/validation';

/**
 * /digital-card/:id (GloabalDigitalCard.js): clicking the photo first checks the full-size photo
 * with a HEAD request; when that gets no answer the page says so. The HEAD is aborted in the
 * browser; nothing is changed.
 */

/**
 * The route id, minted as the app's utils/Crypto.js encryptId does: CryptoJS.AES.encrypt with a
 * passphrase, i.e. OpenSSL "Salted__" + salt + AES-256-CBC with an MD5 EVP_BytesToKey key/iv.
 * A cipher text without "/" or "+" is chosen so the path segment is the same encoded or not.
 */
function encryptId(plain: string, passphrase = 'your-secret-key'): string {
  for (;;) {
    const salt = randomBytes(8);
    let derived = Buffer.alloc(0);
    let block = Buffer.alloc(0);
    while (derived.length < 48) {
      block = createHash('md5')
        .update(Buffer.concat([block, Buffer.from(passphrase), salt]))
        .digest();
      derived = Buffer.concat([derived, block]);
    }
    const cipher = createCipheriv('aes-256-cbc', derived.subarray(0, 32), derived.subarray(32, 48));
    const id = Buffer.concat([
      Buffer.from('Salted__'),
      salt,
      cipher.update(plain, 'utf8'),
      cipher.final(),
    ]).toString('base64');
    if (!/[/+]/.test(id)) return id;
  }
}

test.describe(
  'KPost — /digital-card/:id reports a photo it could not load',
  {
    tag: ['@ui', '@verticals', '@regression'],
    annotation: [{ type: 'non-functional', description: 'resilience' }],
  },
  () => {
    test.skip(!testData.victimKpostId, 'needs a real live account (QA_VICTIM_KPOST_ID)');

    test('a full-size photo check that gets no answer says "Error loading image!"', async ({
      page,
    }) => {
      let aborted = 0;
      await page.route('**/profile/downloadFullProfileImage/**', (route) => {
        if (route.request().method() !== 'HEAD') return route.fallback();
        aborted += 1;
        return route.abort();
      });
      await page.goto(`/digital-card/${encodeURIComponent(encryptId(testData.victimKpostId))}`, {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
      });
      const photo = page.locator('img.gdc-avatar').first();
      await expect(photo, 'the card renders its photo').toBeVisible({ timeout: 20_000 });
      await photo.click();
      await expect(toast(page, 'Error loading image!'), 'the user is told').toBeVisible({
        timeout: 10_000,
      });
      expect(aborted, 'the photo check was aborted in the browser').toBeGreaterThanOrEqual(1);
    });
  },
);
