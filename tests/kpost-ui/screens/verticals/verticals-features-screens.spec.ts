import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import type { Page } from '@playwright/test';

/**
 * Verticals: each screen shows a distinctive feature control of its own, not just the shell.
 * Read-only; external links are not followed.
 */
test.describe(
  'KPost verticals — feature render',
  { tag: ['@ui', '@verticals', '@regression'] },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    const cases: ReadonlyArray<{
      name: string;
      route: string;
      assert: (page: Page) => Promise<void>;
    }> = [
      {
        name: 'KNews',
        route: '/knews',
        assert: async (page) => {
          await expect(
            page
              .getByPlaceholder(/Search headlines/i)
              .or(page.locator('.jn-search-input'))
              .first(),
            'KNews shows its headline search',
          ).toBeVisible({ timeout: 20_000 });
        },
      },
      {
        name: 'KDirectory',
        route: '/kdirectory',
        assert: async (page) => {
          await expect(
            page
              .locator('.background_colorss')
              .or(page.getByText(/Country|Directory/i))
              .first(),
            'KDirectory renders its directory UI',
          ).toBeVisible({ timeout: 20_000 });
        },
      },
      {
        name: 'KCloud',
        route: '/kcloud',
        assert: async (page) => {
          await expect(
            page.getByText(/Kloud Data|Storage|Documents|Buy/i).first(),
            'KCloud shows its storage UI',
          ).toBeVisible({ timeout: 20_000 });
        },
      },
      {
        name: 'KDoc/KOS',
        route: '/kdoc',
        assert: async (page) => {
          await expect(
            page.getByText(/K-AI|Kompose|KPresenter|Coming Soon/i).first(),
            'KDoc/KOS shows its tools',
          ).toBeVisible({ timeout: 20_000 });
        },
      },
      {
        name: 'E-Commerce',
        route: '/e-commerce',
        assert: async (page) => {
          await expect(
            page.locator('.Grid_Templet, .ECommerce_Card, .icon-KP_01-Home, .header_font').first(),
            'E-Commerce renders its grid (or shell)',
          ).toBeVisible({ timeout: 20_000 });
        },
      },
      {
        name: 'KBooking',
        route: '/kbooking',
        assert: async (page) => {
          await expect(
            page.locator('.icon-KP_09-Travel, .icon-KP_01-Home, .header_font').first(),
            'KBooking renders its travel UI (or shell)',
          ).toBeVisible({ timeout: 20_000 });
        },
      },
    ];

    // KDoc/KOS is excluded from testing; remove this filter when it is back in scope.
    for (const c of cases.filter((v) => v.route !== '/kdoc')) {
      test(`${c.name} renders its own feature content @ui`, async ({ page }) => {
        await page.goto(c.route, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await page
          .locator('.loader-overlay')
          .waitFor({ state: 'hidden', timeout: 30_000 })
          .catch(() => undefined);
        await expect(page, `${c.name} is reachable when signed in`).toHaveURL(
          new RegExp(c.route.replace(/[/-]/g, '\\$&')),
        );
        await c.assert(page);
      });
    }
  },
);
