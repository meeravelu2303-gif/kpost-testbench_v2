import type { Page } from '@playwright/test';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { pickReactSelect } from '../support/react-select';
import { toast } from '../support/validation';

/**
 * K-Booking (/kbooking) › Search Buses refuses an incomplete or impossible search (KBook.js
 * handleSearchBuss: From, To and Date are required) and sends a valid one. The redbus trip search
 * (availabletrips) is blocked at the network, so no search reaches redbus and nothing is booked.
 */

const AVAILABLE_TRIPS = '**/redbus/availabletrips/**';

/** Blocks the trip search; returns the bodies the screen tried to send. */
async function blockSearch(page: Page): Promise<Array<Record<string, unknown>>> {
  const sent: Array<Record<string, unknown>> = [];
  await page.route(AVAILABLE_TRIPS, (route) => {
    sent.push(JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>);
    return route.abort();
  });
  return sent;
}

async function openSearch(page: Page) {
  await page.goto('/kbooking', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page
    .locator('.loader-overlay')
    .waitFor({ state: 'hidden', timeout: 30_000 })
    .catch(() => undefined);
  // From is the 1st react-select control, To the 2nd.
  const from = page.locator('.react-select__control').first();
  await expect(from, 'the search form renders').toBeVisible({ timeout: 15_000 });
  return {
    from,
    to: page.locator('.react-select__control').nth(1),
    date: page.locator('input[type="date"]').first(),
    search: page.getByRole('button', { name: /Search Buses/i }).first(),
  };
}

const localDay = (offsetDays: number): string => {
  const d = new Date(Date.now() + offsetDays * 24 * 3600_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const MISSING_FIELDS = 'Please Check the Departure Point, Arrival Place and Date';

test.describe(
  'KPost K-Booking · Search Buses refuses an incomplete or impossible search',
  { tag: ['@ui', '@verticals', '@regression'] },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    test('a search with no cities is refused and never sent', async ({ page }) => {
      const sent = await blockSearch(page);
      const form = await openSearch(page);
      await form.search.click();
      await expect(toast(page, MISSING_FIELDS), 'the user is told what is missing').toBeVisible({
        timeout: 10_000,
      });
      expect(sent, 'a search with no cities never reaches redbus').toHaveLength(0);
    });

    test('a search with no arrival city is refused and never sent', async ({ page }) => {
      const sent = await blockSearch(page);
      const form = await openSearch(page);
      await pickReactSelect(form.from, 'Delhi');
      await form.search.click();
      await expect(toast(page, MISSING_FIELDS), 'the user is told what is missing').toBeVisible({
        timeout: 10_000,
      });
      expect(sent, 'a search with no arrival city never reaches redbus').toHaveLength(0);
    });

    test('a travel date in the past is refused and never sent', async ({ page }) => {
      const sent = await blockSearch(page);
      const form = await openSearch(page);
      await pickReactSelect(form.from, 'Delhi');
      await pickReactSelect(form.to, 'Jaipur');
      await form.date.fill(localDay(-1));
      const wronglySent = page
        .waitForRequest((r) => r.url().includes('/redbus/availabletrips/'), { timeout: 5_000 })
        .catch(() => null);
      await form.search.click();
      await wronglySent;
      // Both halves are judged, so a missing message does not hide a search that was sent.
      expect.soft(sent, 'a search for a day already gone never reaches redbus').toHaveLength(0);
      await expect
        .soft(
          page.locator('.Toastify__toast, .text-danger').filter({ hasText: /date/i }).first(),
          'the user is told the date has passed',
        )
        .toBeVisible({ timeout: 10_000 });
    });

    test('a complete search is sent for the chosen day', async ({ page }) => {
      const sent = await blockSearch(page);
      const form = await openSearch(page);
      await pickReactSelect(form.from, 'Delhi');
      await pickReactSelect(form.to, 'Jaipur');
      await form.date.fill(localDay(1));
      await form.search.click();
      await expect
        .poll(() => sent.length, { message: 'the search is sent', timeout: 10_000 })
        .toBeGreaterThan(0);
      expect(sent[0]?.travelDate, 'for the day chosen').toBe(localDay(1));
      expect(sent[0]?.sourceCityID, 'with a departure city').toBeTruthy();
      expect(sent[0]?.destinationCityID, 'and an arrival city').toBeTruthy();
    });
  },
);
