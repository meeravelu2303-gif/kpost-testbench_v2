import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Settings profile header card (always shown on /settings): Cover Photo upload and Remove, which restores
 * itself. Avatar is skipped (it reloads the page). Gated behind SETTINGS_UI_LIFECYCLE=true.
 */
test.describe(
  'KPost Settings · Profile header (Cover Photo)',
  { tag: ['@ui', '@settings', '@regression'] },
  () => {
    test.skip(
      process.env.SETTINGS_UI_LIFECYCLE !== 'true',
      'uploads/removes a real cover image; set SETTINGS_UI_LIFECYCLE=true',
    );
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    const PNG_1X1 = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AL+6ZlWAAAAAElFTkSuQmCC',
      'base64',
    );

    test('uploading a non-image file as a cover photo is rejected client-side, before any upload call @ui', async ({
      page,
      settingsPage,
    }) => {
      await settingsPage.goto();

      let uploadFired = false;
      page.on('request', (req) => {
        if (req.url().includes('/profile/uploadCoverImage')) uploadFired = true;
      });

      const coverInput = page.locator('input[type="file"]').first();
      await coverInput.setInputFiles({
        name: 'not-an-image.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('this is not an image'),
      });

      await expect(
        page.getByText(/Only image files are allowed/i).first(),
        'a non-image file is rejected with the documented error toast',
      ).toBeVisible({ timeout: 10_000 });

      expect(
        uploadFired,
        'a rejected file type must never reach the real uploadCoverImage API call',
      ).toBe(false);
    });

    test('uploading then removing a cover photo round-trips through the real API @ui', async ({
      page,
      settingsPage,
    }) => {
      await settingsPage.goto();

      const coverInput = page.locator('input[type="file"]').first();
      const uploadPromise = page.waitForRequest(
        (req) => req.url().includes('/profile/uploadCoverImage') && req.method() === 'POST',
        { timeout: 15_000 },
      );
      await coverInput.setInputFiles({
        name: 'qa-bench-cover.png',
        mimeType: 'image/png',
        buffer: PNG_1X1,
      });
      await uploadPromise;

      // The icon-font span defeats getByRole's accessible name, so match the button's text.
      const removeButton = page.getByText(/^Remove$/i).first();
      await expect(removeButton, 'a Remove control appears once a cover is set').toBeVisible({
        timeout: 15_000,
      });

      const removePromise = page.waitForRequest(
        (req) => req.url().includes('/profile/removeCoverImage'),
        { timeout: 15_000 },
      );
      await removeButton.click();
      await removePromise;

      await expect(
        page.getByText(/Add Cover Photo/i).first(),
        'after removal, the panel returns to its no-cover placeholder state',
      ).toBeVisible({ timeout: 15_000 });
    });
  },
);
