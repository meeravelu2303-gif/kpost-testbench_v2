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

  /**
   * Locate by the react-select PLACEHOLDER text itself (`.first()`), not a fragile container+hasText
   * filter — the placeholder is rendered as plain visible text until a value is chosen, at which point
   * it disappears from the match set entirely. This is what makes `.first()` safe even for "Select your
   * days" (retention + archive both use this exact placeholder): once the first one is filled, only the
   * second still matches. Proven pattern, same one used for Settings' Personalize country/language
   * fields earlier this session.
   *
   * Four fields (Publications, Category, Sub-Category, City/Town) are `isMulti` CHECKBOX lists, not
   * plain single-select — confirmed from source (`Knewssettings.js`, `isMulti={true}`). A checkbox
   * list has no close-on-select behavior, so after checking one box this presses Escape to close the
   * menu and commit the field as "set" (the component only cares that `knewsdata.<field>` is
   * non-empty to unlock the next field, per the `isDisabled={knewsdata.X ? false : true}` chain).
   */
  async function pick(
    page: import('@playwright/test').Page,
    placeholder: string,
    option: string,
    multi = false,
  ) {
    const control = page.getByText(placeholder, { exact: true }).first();
    await expect(control, `the "${placeholder}" control is visible and enabled`).toBeVisible({
      timeout: 10_000,
    });
    await control.click({ force: true });
    await page.waitForTimeout(250);
    await page.locator('.react-select__menu').getByText(option, { exact: true }).click();
    await page.waitForTimeout(250);
    if (multi) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
    }
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

    // Excludes static assets (scripts/styles/fonts) and health checks — this watches for a real
    // XHR/fetch to a KPost backend endpoint, not incidental page-chrome resource loading (a Google
    // Fonts woff2 request was the one false positive found while building this check).
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

    // Values below are each real option labels confirmed directly from Knewssettings.js's own option
    // arrays — several fields have NO "All" option at all (State, Publications, both day-pickers,
    // Languages all use specific values only; Category/Sub-Category use "All Category", not "All").
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
    await expect(page.getByText(/384/).first(), 'the hardcoded total payable amount renders').toBeVisible();

    expect(
      requestFired,
      'KNews Settings is confirmed from source to make no backend network calls anywhere in this flow',
    ).toBe(false);
  });
});
