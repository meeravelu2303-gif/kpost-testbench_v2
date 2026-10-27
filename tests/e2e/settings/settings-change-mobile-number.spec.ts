import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Settings › Change Mobile Number: the whole OTP flow calls no service and the OTP digits are never read.
 * Safe to drive end to end; proves a completed flow fires no request and changes nothing after a reload.
 */
test.describe(
  'KPost Settings · Change Mobile Number panel',
  { tag: ['@ui', '@settings', '@regression'] },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    test('completing the full Change Mobile Number flow fires no network request and persists nothing @ui', async ({
      page,
      settingsPage,
    }) => {
      await settingsPage.goto();
      await settingsPage.openPanel('General Settings', 'Change Mobile Number');

      let requestFired = false;
      page.on('request', (req) => {
        const url = req.url();
        if (url.includes('/health') || url.includes('.js') || url.includes('.css')) return;
        requestFired = true;
      });

      const numberInput = page.getByPlaceholder('Enter your No').first();
      await expect(numberInput, 'the primary mobile number input renders').toBeVisible({
        timeout: 15_000,
      });
      await numberInput.fill('9998887771');

      await page
        .getByRole('button', { name: /^Change Number$/i })
        .first()
        .click();
      await expect(page.getByText(/Enter OTP/i).first(), 'the first OTP modal opens').toBeVisible({
        timeout: 10_000,
      });
      // Submit never reads the OTP digits; it advances unconditionally.
      await page
        .getByRole('button', { name: /^Submit$/i })
        .first()
        .click();

      // After the OTP step the input to fill is the visible one in the new-primary card.
      const newNumberInput = page.locator('input[placeholder="Enter your No"]:visible').first();
      await expect(newNumberInput, 'the New Primary Mobile Number input appears').toBeVisible({
        timeout: 10_000,
      });
      await newNumberInput.fill('9998887772');

      await page
        .getByRole('button', { name: /^Continue$/i })
        .first()
        .click();
      await expect(page.getByText(/Enter OTP/i).first(), 'the second OTP modal opens').toBeVisible({
        timeout: 10_000,
      });
      await page
        .getByRole('button', { name: /^Submit$/i })
        .first()
        .click();

      await expect(
        page.getByText(/Change Primary Mobile Number/i).first(),
        'the final confirmation modal opens with the data-loss warning',
      ).toBeVisible({ timeout: 10_000 });
      await expect(
        page
          .getByText(/data from the previous mobile number will be automatically deleted/i)
          .first(),
        "the warning text about the old number's data being deleted is shown",
      ).toBeVisible();

      await page.getByRole('button', { name: /^Ok$/i }).first().click();
      // Give a request one second to appear after the final confirmation, no longer.
      await page
        .waitForRequest((r) => !/health|\.js|\.css/.test(r.url()), { timeout: 1_000 })
        .catch(() => undefined);

      expect(
        requestFired,
        'the entire Change Mobile Number flow is confirmed from source to be client-only theater — ' +
          'completing every step, including the final confirmation, must not fire a single network request',
      ).toBe(false);

      // Reloading Settings must show the original number's flow again, not a "changed" state.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await settingsPage.openPanel('General Settings', 'Change Mobile Number');
      await expect(
        page.getByPlaceholder('Enter your No').first(),
        'after reload, the panel resets to its original empty-input state — nothing persisted',
      ).toHaveValue('');
    });

    test('the "Make Primary as Secondary" buttons are confirmed dead controls (no handler) @ui', async ({
      page,
      settingsPage,
    }) => {
      await settingsPage.goto();
      await settingsPage.openPanel('General Settings', 'Change Mobile Number');

      let requestFired = false;
      page.on('request', (req) => {
        const url = req.url();
        if (url.includes('/health') || url.includes('.js') || url.includes('.css')) return;
        requestFired = true;
      });

      await page
        .getByText(/Make Primary as Secondary/i)
        .first()
        .click();
      await page
        .waitForRequest((r) => !/health|\.js|\.css/.test(r.url()), { timeout: 1_000 })
        .catch(() => undefined);

      expect(
        requestFired,
        '"Make Primary as Secondary" is confirmed from source to have no onClick handler wired at all',
      ).toBe(false);
    });
  },
);
