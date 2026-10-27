import { testData } from '@config/test-data.config';
import type { Page } from '@playwright/test';
import { expect, test } from '@fixtures';
import { pickReactSelect, reactSelectByPlaceholder } from '../support/react-select';

/**
 * Settings › KNews Settings: an 11-field cascading form ending in a Submit that only shows a summary.
 * No service is called; the summary's cost figures are hardcoded whatever was selected.
 */
test.describe(
  'KPost Settings · KNews Settings panel',
  { tag: ['@ui', '@settings', '@regression'] },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    /**
     * Fill the control still showing `placeholder` (safe for the two "Select your days" fields: the
     * filled one stops matching).
     */
    async function pick(page: Page, placeholder: string, option: string, multi = false) {
      // Driven through the control's own input (support/react-select.ts); the isMulti checkbox lists
      // do not filter on typed text, so they are opened and read instead.
      await pickReactSelect(reactSelectByPlaceholder(page, placeholder), option, {
        multi,
        typeToFilter: !multi,
      });
    }

    test('the full 11-field chain unlocks in order, and Submit reveals a hardcoded summary regardless of selections @ui', async ({
      page,
      settingsPage,
    }) => {
      await settingsPage.goto();
      await settingsPage.openTopLevelPanel('KNews Settings');

      await expect(page.getByText(/^Knews Settings$/i).first(), 'the panel renders').toBeVisible({
        timeout: 15_000,
      });

      const submitButton = page.getByRole('button', { name: /^Submit$/i });
      await expect(submitButton, 'Submit starts disabled with nothing selected').toBeDisabled();

      // Excludes static assets and health checks: only a real XHR/fetch to a KPost backend counts.
      let requestFired = false;
      page.on('request', (req) => {
        const url = req.url();
        if (
          url.includes('/health') ||
          url.includes('.js') ||
          url.includes('.css') ||
          url.includes('fonts.gstatic.com') ||
          url.includes('fonts.googleapis.com') ||
          /\.(woff2?|ttf|otf|png|jpe?g|svg|gif|ico)(\?|$)/i.test(url)
        ) {
          return;
        }
        requestFired = true;
      });

      // Real option labels from the source; several fields have no "All" option.
      await pick(page, 'Select Country Name', 'India');
      await pick(page, 'Select Publications', 'India Today', true); // isMulti checkbox list, no "All"
      await pick(page, 'Select State', 'Tamil Nadu'); // no "All" option exists for State
      await pick(page, 'Select Category', 'All Category', true); // isMulti; label is "All Category"
      await pick(page, 'Select City/Town', 'All', true); // isMulti; this one genuinely has "All"
      await pick(page, 'Select Sub-Category', 'All Category', true); // isMulti; label is "All Category"
      await pick(page, 'Select News Type', 'All');
      await pick(page, 'Select your days', '10 Days'); // retention days — no "All" option exists
      await pick(page, 'Select News Source', 'All');
      await pick(page, 'Select your days', '10 Days'); // archive days — no "All" option exists
      await pick(page, 'Select Languages', 'English');

      await expect(submitButton, 'Submit becomes enabled once every field is set').toBeEnabled({
        timeout: 10_000,
      });
      await submitButton.click();

      await expect(
        page.getByText(/Summary of Customized News/i).first(),
        'submitting reveals the summary screen',
      ).toBeVisible({ timeout: 10_000 });
      // Confirmed hardcoded regardless of selections made above.
      await expect(
        page.getByText(/384/).first(),
        'the hardcoded total payable amount renders',
      ).toBeVisible();

      expect(
        requestFired,
        'KNews Settings is confirmed from source to make no backend network calls anywhere in this flow',
      ).toBe(false);
    });
  },
);
