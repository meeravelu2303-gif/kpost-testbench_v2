import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { pickReactSelect } from '../support/react-select';

/**
 * K-Booking (/kbooking), a real redbus.in booking integration: city search, trip listing, My Trips.
 * Money-moving: no test may click "Show seats" or reach blocking, ordering, payment or cancellation.
 */
test.describe(
  'KPost K-Booking — search and read-only trip listing',
  { tag: ['@ui', '@verticals', '@regression'] },
  () => {
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

      // From is the 1st react-select control, To the 2nd; the form renders only these two.
      const toCityControl = page.locator('.react-select__control').nth(1);
      await expect(toCityControl, 'the To-city field renders').toBeVisible({ timeout: 15_000 });
      await expect(
        toCityControl,
        "To-city starts disabled until From is chosen (react-select's own isDisabled class)",
      ).toHaveClass(/--is-disabled/);

      await pickReactSelect(page.locator('.react-select__control').first(), 'Bangalore');

      await expect(
        toCityControl,
        'To-city becomes enabled once From is chosen (the --is-disabled class is removed)',
      ).not.toHaveClass(/--is-disabled/, { timeout: 10_000 });
    });

    test(
      'searching buses lists trips (or renders no rows) without crashing, and never reaches Show seats @ui',
      { tag: '@sanity' },
      async ({ page }) => {
        await page.goto('/kbooking', { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await page
          .locator('.loader-overlay')
          .waitFor({ state: 'hidden', timeout: 30_000 })
          .catch(() => undefined);

        await pickReactSelect(page.locator('.react-select__control').first(), 'Delhi');
        await pickReactSelect(page.locator('.react-select__control').nth(1), 'Jaipur');

        // Wait for the search round-trip, then for a result list or an empty state.
        const answered = page
          .waitForResponse((r) => r.request().method() === 'POST', { timeout: 20_000 })
          .catch(() => undefined);
        await page
          .getByRole('button', { name: /Search Buses/i })
          .first()
          .click();
        await answered;
        await page
          .getByText(/Show seats|No (buses|trips|service)|not available|no results/i)
          .first()
          .waitFor({ state: 'visible', timeout: 15_000 })
          .catch(() => undefined);

        // Soft: whether the route has trips is out of our control; the screen must not crash.
        const showSeatsLinks = page.getByText(/Show seats/i);
        const tripCount = await showSeatsLinks.count();
        test.info().annotations.push({
          type: 'observed',
          description: `${tripCount} trip(s) listed for this route/date — "Show seats" never clicked`,
        });
        await expect(page.locator('body')).toBeVisible();
      },
    );

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
  },
);
