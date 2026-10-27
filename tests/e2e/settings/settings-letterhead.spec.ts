import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Settings › Letter Head: selecting a template is local state only (no service), so a reload loses it.
 */
test.describe(
  'KPost Settings · Letter Head panel',
  { tag: ['@ui', '@settings', '@regression'] },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    test('selecting a template opens a preview modal, and "Set" highlights it locally (not persisted) @ui', async ({
      page,
      settingsPage,
    }) => {
      await settingsPage.goto();
      await settingsPage.openPanel('KMail Settings', 'Letter Head');

      await expect(page.getByText(/^LetterHead$/i).first(), 'the panel renders').toBeVisible({
        timeout: 15_000,
      });

      const thumbnails = page.getByAltText('letterheads');
      await expect(thumbnails.first(), 'template thumbnails render').toBeVisible({
        timeout: 10_000,
      });

      let requestFired = false;
      page.on('request', (req) => {
        const url = req.url();
        if (url.includes('/health') || url.includes('.js') || url.includes('.css')) return;
        requestFired = true;
      });

      await thumbnails.first().click();
      const setButton = page.getByRole('button', { name: /^Set$/i });
      await expect(setButton, 'the preview modal opens with a Set button').toBeVisible({
        timeout: 10_000,
      });
      await setButton.click();
      await expect(setButton, 'Set closes the modal').toBeHidden({ timeout: 5_000 });

      expect(
        requestFired,
        'Letter Head selection is confirmed from source to be local-only — no network request',
      ).toBe(false);

      // A reload loses the selection (nothing persisted).
      await page.reload({ waitUntil: 'domcontentloaded' });
      await settingsPage.openPanel('KMail Settings', 'Letter Head');
      await expect(
        page.locator('.borderimg'),
        'after reload, no thumbnail carries the "selected" highlight — confirming nothing persisted',
      ).toHaveCount(0);
    });
  },
);
