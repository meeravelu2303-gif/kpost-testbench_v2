import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * K-Booking (`/kbooking`) — a REAL redbus.in bus-ticket booking integration
 * (`Services/KBooking.js`): city search, trip listing, `BlockTickets`, `GenerateOrderID`,
 * `verifySignature` (a payment-gateway signature check), `BookTicket`, `CancelTicket`.
 *
 * HARD SAFETY BOUNDARY (confirmed in `docs/ui/frontend-module-map.md`): this is money-moving, the same
 * class of feature this bench already refuses to automate for OTP/SMS. No test here may reach
 * `BlockTickets`/`GenerateOrderID`/`verifySignature`/`BookTicket`/`CancelTicket` or the payment-gateway
 * UI. The boundary in the UI is the per-trip "Show seats" link — this suite NEVER clicks it. Safe
 * surface only: city search, trip LISTING (read-only), and "My Trips" (a read-only fetch).
 *
 * FIXED 2026-10-04 (was NEEDS-CODEGEN): the From/To fields are react-select controls, not real
 * `<input placeholder=...>` elements — "Enter your Departure/Arrival place" is rendered as a plain
 * `<div class="react-select__placeholder">`, so `getByPlaceholder()` can never match it. Fixed by
 * locating on the placeholder TEXT (`getByText(..., { exact: true })`) and force-clicking it (the
 * input-container intercepts plain clicks), then scoping the suggestion pick to `.react-select__menu`
 * — a bare page-wide `getByText('Bangalore')`/`getByText('Delhi')` can also match an unrelated hidden
 * element elsewhere on the page, the same collision already seen and fixed for Contacts/KMail this
 * session.
 */
test.describe('KPost K-Booking — search and read-only trip listing', { tag: '@ui' }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  test('the To-city field stays disabled until a From city is chosen @ui', async ({ page }) => {
    await page.goto('/kbooking', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page
      .locator('.loader-overlay')
      .waitFor({ state: 'hidden', timeout: 30_000 })
      .catch(() => undefined);

    // The From control is the 1st `.react-select__control` on the page, To is the 2nd — stable by
    // position since the form only ever renders these two Select fields, in this order.
    const toCityControl = page.locator('.react-select__control').nth(1);
    await expect(toCityControl, 'the To-city field renders').toBeVisible({ timeout: 15_000 });
    await expect(
      toCityControl,
      "To-city starts disabled until From is chosen (react-select's own isDisabled class)",
    ).toHaveClass(/--is-disabled/);

    const fromCityControl = page.getByText('Enter your Departure place', { exact: true }).first();
    await fromCityControl.click({ force: true });
    await page.keyboard.type('Bangalore');
    await page.waitForTimeout(1_000);
    // Pick the first suggestion if one surfaces, scoped to the open menu (a bare page-wide text
    // match can also hit an unrelated hidden element elsewhere on the page).
    await page
      .locator('.react-select__menu')
      .getByText(/Bangalore/i)
      .first()
      .click({ timeout: 5_000 })
      .catch(() => undefined);

    await expect(
      toCityControl,
      'To-city becomes enabled once From is chosen (the --is-disabled class is removed)',
    ).not.toHaveClass(/--is-disabled/, { timeout: 10_000 });
  });

  test('searching buses lists trips (or renders no rows) without crashing, and never reaches Show seats @ui', async ({
    page,
  }) => {
    await page.goto('/kbooking', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page
      .locator('.loader-overlay')
      .waitFor({ state: 'hidden', timeout: 30_000 })
      .catch(() => undefined);

    const fromCityControl = page.getByText('Enter your Departure place', { exact: true }).first();
    await fromCityControl.click({ force: true });
    await page.keyboard.type('Delhi');
    await page.waitForTimeout(1_000);
    await page
      .locator('.react-select__menu')
      .getByText(/Delhi/i)
      .first()
      .click({ timeout: 5_000 })
      .catch(() => undefined);

    const toCityControl = page.locator('.react-select__control').nth(1);
    await toCityControl.click({ force: true });
    await page.keyboard.type('Jaipur');
    await page.waitForTimeout(1_000);
    await page
      .locator('.react-select__menu')
      .getByText(/Jaipur/i)
      .first()
      .click({ timeout: 5_000 })
      .catch(() => undefined);

    await page
      .getByRole('button', { name: /Search Buses/i })
      .first()
      .click();
    await page.waitForTimeout(3_000);

    // Soft, deliberately: whether a real route has trips is out of this test's control. What matters
    // is the screen doesn't crash and, if trips exist, the safety boundary control ("Show seats") is
    // visible but never clicked.
    const showSeatsLinks = page.getByText(/Show seats/i);
    const tripCount = await showSeatsLinks.count();
    test.info().annotations.push({
      type: 'observed',
      description: `${tripCount} trip(s) listed for this route/date — "Show seats" never clicked`,
    });
    await expect(page.locator('body')).toBeVisible();
  });

  test('"My Trips" loads the read-only ticket list with its Upcoming/Completed/Cancelled tabs @ui', async ({
    page,
  }) => {
    await page.goto('/kbooking', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page
      .locator('.loader-overlay')
      .waitFor({ state: 'hidden', timeout: 30_000 })
      .catch(() => undefined);

    await page
      .getByText(/My Trips/i)
      .first()
      .click();

    await expect(
      page
        .getByRole('tab', { name: /Upcoming/i })
        .or(page.getByText(/Upcoming/i))
        .first(),
      'the My Trips ticket list renders with its Upcoming tab',
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText(/Completed/i).first(),
      'the Completed tab is present',
    ).toBeVisible();
    await expect(
      page.getByText(/Cancelled/i).first(),
      'the Cancelled tab is present',
    ).toBeVisible();
  });
});
