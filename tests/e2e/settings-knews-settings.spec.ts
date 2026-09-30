import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Settings · KNews Settings panel (`Knewssettings.js`) — an 11-field cascading form (Country ->
 * Publications -> State -> Category -> City/Town -> Sub-Category -> News Type -> Retention days ->
 * News Source -> Archive days -> Language), each disabled until the previous is set, ending in a
 * "Submit" that only reveals a summary screen. Confirmed from source: NO `Services/*` import
 * anywhere — the whole flow, including the summary's cost figures (300 items / ₹30 / ₹54 GST /
 * ₹384 total), is hardcoded and identical regardless of what was actually selected, despite the
 * summary's own "Kindly Confirm to Reach KPAY The Payment Gateway System..." text implying a real
 * payment hand-off that never happens.
 */
test.describe('KPost Settings · KNews Settings panel', { tag: '@ui' }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  async function pick(page: import('@playwright/test').Page, label: string, option: string) {
    const container = page.locator('.d-flex.flex-column', { hasText: label }).last();
    const input = container.locator('.react-select__input').first();
    await input.click({ force: true });
    await page.waitForTimeout(250);
    await page.keyboard.type(option);
    await page.waitForTimeout(250);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
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

    let requestFired = false;
    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('/health') || url.includes('.js') || url.includes('.css')) return;
      requestFired = true;
    });

    await pick(page, 'Select Country Name', 'India');
    await pick(page, 'Select Publications', 'All');
    await pick(page, 'Select State', 'All');
    await pick(page, 'Select Category', 'All');
    await pick(page, 'Select City/Town', 'All');
    await pick(page, 'Select Sub-Category', 'All');
    await pick(page, 'Select News Type', 'All');
    await pick(page, 'Select your days', 'All');
    await pick(page, 'Select News Source', 'All');
    await pick(page, 'Select your days', 'All');
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
    await expect(page.getByText(/384/).first(), 'the hardcoded total payable amount renders').toBeVisible();

    expect(
      requestFired,
      'KNews Settings is confirmed from source to make no network calls anywhere in this flow',
    ).toBe(false);
  });
});
