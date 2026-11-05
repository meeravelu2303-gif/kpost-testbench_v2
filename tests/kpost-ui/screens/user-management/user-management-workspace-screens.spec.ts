import { STORAGE_STATE_BUSINESS } from '@config/constants';
import { testData } from '@config/test-data.config';
import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';
import type { Locator, Page } from '@playwright/test';
import { openUserManagement } from '../../support/usermanagement';

/**
 * User Management (/usermanagement, BUSINESS_S company admin): each view renders its key controls
 * (UserManagement.js:1390-1990): the licence summary, the three channel tabs (Add New / Allocated /
 * Unallocated), the member search, the Allocated and Unallocated lists with their counts, and a
 * member's Digital Card. Read-only: "Add New" is never clicked (it opens the provisioning form) and
 * no card action (Allocate / Reset / Terminate) is pressed. The business account is shared with
 * developers.
 */
test.describe(
  'KPost User Management · screens render their key controls (BUSINESS_S)',
  { tag: ['@ui', '@user-management', '@regression'] },
  () => {
    test.use({ storageState: STORAGE_STATE_BUSINESS });

    test.skip(
      process.env.BUSINESS_UI_LIFECYCLE !== 'true',
      'needs the BUSINESS_S admin session; set BUSINESS_UI_LIFECYCLE=true',
    );
    test.skip(
      !testData.businessSKpostId || testData.businessSKpostId.includes('qa.business'),
      'needs the BUSINESS_S account (QA_BUSINESS_S_KPOST_ID)',
    );

    /** One of the three channel tabs, by its exact label (so "Allocated" never matches "Unallocated"). */
    const channelTab = (page: Page, label: 'Add New' | 'Allocated' | 'Unallocated'): Locator =>
      page
        .locator('.channelslist > div')
        .filter({ has: page.locator('.license', { hasText: new RegExp(`^${label}$`) }) })
        .first();
    const memberRows = (page: Page): Locator =>
      page.locator('.Members_Height .justify-content-between.px-2.align-items-center');

    test('the workspace renders the licence summary, the channel tabs and the member search @ui', async ({
      page,
    }) => {
      const stop = watchUiHealth(page);
      await openUserManagement(page);

      await expect
        .soft(page.locator('.Title', { hasText: /Business User Management/i }).first())
        .toBeVisible();
      await expect
        .soft(page.getByText(/Total Licenses/i).first(), 'Total Licenses count')
        .toBeVisible();
      await expect
        .soft(page.locator('.icons-premium').first(), 'the plan badge (Premium)')
        .toBeVisible();
      for (const label of ['Add New', 'Allocated', 'Unallocated'] as const)
        await expect.soft(channelTab(page, label), `the "${label}" channel tab`).toBeVisible();
      await expect
        .soft(channelTab(page, 'Add New'), 'the "Add New" tab shows a channel count')
        .toHaveText(/\d+\s*Channels/);
      await expect
        .soft(page.getByPlaceholder('Search members...').first(), 'the member search box')
        .toBeVisible();
      await expect
        .soft(
          page.locator('.sticky_searchHeader .user-header.members').first(),
          'the member list header with its count',
        )
        .toHaveText(/Channels|Members/);

      const health = stop();
      expect(health.pageErrors, 'no uncaught JS error rendering the workspace').toEqual([]);
    });

    test('the Allocated view lists allocated channels with their count and its own search @ui', async ({
      page,
    }) => {
      await openUserManagement(page);
      await channelTab(page, 'Allocated').click();
      await expect(
        page.getByText(/(Channels|Members) Allocated\s*\(\d+\)/).first(),
        'the Allocated list heading with its count',
      ).toBeVisible({ timeout: 15_000 });
      await expect
        .soft(page.getByPlaceholder('Search members...').first(), 'the Allocated search box')
        .toBeVisible();
      await expect
        .soft(channelTab(page, 'Allocated'), 'the Allocated tab is highlighted as selected')
        .toHaveClass(/user-button/);
    });

    test('the Unallocated view lists unallocated channels with their count and its own search @ui', async ({
      page,
    }) => {
      await openUserManagement(page);
      await channelTab(page, 'Unallocated').click();
      await expect(
        page.getByText(/(Channels Unallocated|On Hold Members)\s*\(\s*\d+\s*\)/).first(),
        'the Unallocated list heading with its count',
      ).toBeVisible({ timeout: 15_000 });
      await expect
        .soft(page.getByPlaceholder('Search members...').first(), 'the Unallocated search box')
        .toBeVisible();
      await expect
        .soft(channelTab(page, 'Unallocated'), 'the Unallocated tab is highlighted as selected')
        .toHaveClass(/user-button/);
    });

    test("a member's Digital Card renders the member's name and contact rows, and closes @ui", async ({
      page,
    }) => {
      await openUserManagement(page);
      const rows = memberRows(page);
      const hasMember = await rows
        .first()
        .waitFor({ state: 'visible', timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      test.skip(!hasMember, 'the company lists no member to open');

      await rows.first().click();
      const card = page.locator('.dc-shell').first();
      await expect(card, "the member's Digital Card opens").toBeVisible({ timeout: 15_000 });
      await expect
        .soft(card.locator('.dc-name').first(), 'the card shows a name')
        .not.toHaveText(/^\s*-?\s*$/);
      await expect
        .soft(card.locator('.dc-contact-row').first(), 'the card lists contact rows')
        .toBeVisible();

      await page.keyboard.press('Escape');
      await expect(card, 'Escape closes the Digital Card').toBeHidden({ timeout: 10_000 });
    });
  },
);
