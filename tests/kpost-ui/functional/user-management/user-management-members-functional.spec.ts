import { STORAGE_STATE_BUSINESS } from '@config/constants';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import type { Locator, Page } from '@playwright/test';
import { openUserManagement } from '../../support/usermanagement';

/**
 * User Management member list behaviour, read-only (BUSINESS_S company admin):
 * - search filters client-side on name, display name or mobile number (UserManagement.js:177-182,
 *   720-745), and clearing it restores the list;
 * - the list is sorted admins first (UserManagement.js:128-136);
 * - the Allocated / Unallocated tabs filter by active status (UserManagement.js:141-150) and their
 *   headings count what they list;
 * - clicking a member opens that member's Digital Card, and closing it changes nothing.
 * "Add New" is never clicked and no card action is pressed; the account is shared with developers.
 */
test.describe(
  'KPost User Management · member search, filters, ordering and opening a member (BUSINESS_S)',
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

    const channelTab = (page: Page, label: 'Allocated' | 'Unallocated'): Locator =>
      page
        .locator('.channelslist > div')
        .filter({ has: page.locator('.license', { hasText: new RegExp(`^${label}$`) }) })
        .first();
    const memberRows = (page: Page): Locator =>
      page.locator('.Members_Height .justify-content-between.px-2.align-items-center');
    const search = (page: Page): Locator => page.getByPlaceholder('Search members...').first();

    /** Opens the workspace and waits for the member list; skips when the company lists nobody. */
    async function openWithMembers(page: Page): Promise<Locator> {
      await openUserManagement(page);
      const rows = memberRows(page);
      const listed = await rows
        .first()
        .waitFor({ state: 'visible', timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      test.skip(!listed, 'the company lists no member');
      return rows;
    }

    /** The number in a heading such as "Channels Allocated (03)". */
    async function headingCount(page: Page, text: RegExp): Promise<number> {
      const heading = page.getByText(text).first();
      await expect(heading, `the heading ${text.source} renders`).toBeVisible({ timeout: 15_000 });
      const match = /\(\s*(\d+)\s*\)/.exec((await heading.textContent()) ?? '');
      return match ? Number(match[1]) : -1;
    }

    test('the list count in the header matches the members listed @ui', async ({ page }) => {
      const rows = await openWithMembers(page);
      const header = page.locator('.sticky_searchHeader .user-header.members').first();
      const match = /(\d+)/.exec((await header.textContent()) ?? '');
      const count = match ? Number(match[1]) : -1;
      await expect(rows, `the header says ${count} member(s)`).toHaveCount(count);
    });

    test('searching by a member name narrows the list to matches, a no-match term empties it, and clearing restores it @ui', async ({
      page,
    }) => {
      const rows = await openWithMembers(page);
      const total = await rows.count();
      const name = ((await rows.first().locator('.license').first().textContent()) ?? '').trim();
      test.skip(name.length < 2, 'the first member has no name to search for');
      const term = name.slice(0, Math.min(name.length, 6));

      await search(page).fill(term);
      await expect(
        rows.filter({ hasText: name }).first(),
        `"${term}" keeps the member it came from (${name})`,
      ).toBeVisible();
      expect(await rows.count(), 'the search never adds rows').toBeLessThanOrEqual(total);
      // An active row prints all three fields the filter reads (name, display name, mobile); an
      // inactive row hides one, so only active rows are judged.
      for (const text of await rows.filter({ has: page.locator('.phoneno') }).allInnerTexts())
        expect
          .soft(text.toLowerCase(), `every listed row matches "${term}"`)
          .toContain(term.toLowerCase());

      await search(page).fill(`zzqanomatch${Date.now()}`);
      await expect(rows, 'a term no member matches lists nobody').toHaveCount(0);

      await search(page).fill('');
      await expect(rows, 'clearing the search restores the full list').toHaveCount(total);
    });

    test('searching by mobile number finds the member with that number @ui', async ({ page }) => {
      const rows = await openWithMembers(page);
      const withPhone = rows.filter({ has: page.locator('.phoneno') }).first();
      const hasPhone = await withPhone.isVisible().catch(() => false);
      test.skip(!hasPhone, 'no listed member shows a mobile number');
      const phone = ((await withPhone.locator('.phoneno').first().textContent()) ?? '')
        .replace(/^\s*\+91\s*/, '')
        .replace(/\D/g, '');
      test.skip(phone.length < 6, `the listed mobile "${phone}" is too short to search for`);
      const digits = phone.slice(-6);

      await search(page).fill(digits);
      await expect(
        rows.filter({ hasText: digits }).first(),
        `the member whose mobile ends in ${digits} is listed`,
      ).toBeVisible({ timeout: 10_000 });
      for (const text of await rows.allInnerTexts())
        expect
          .soft(text.replace(/\s/g, ''), `every listed row contains ${digits}`)
          .toContain(digits);
    });

    test('members are ordered admins first @ui', async ({ page }) => {
      const rows = await openWithMembers(page);
      // Only active rows print the Admin label, so only they are judged.
      const flags: boolean[] = [];
      for (const row of await rows.all()) {
        if (!(await row.locator('.phoneno').count())) continue;
        const labels = await row.locator('.member-name.admin').allInnerTexts();
        flags.push(labels.some((l) => l.trim() === 'Admin'));
      }
      test.skip(!flags.some(Boolean), 'no active admin is listed');
      const firstNonAdmin = flags.indexOf(false);
      const lastAdmin = flags.lastIndexOf(true);
      expect(
        firstNonAdmin === -1 || lastAdmin < firstNonAdmin,
        `admins come before other members (order: ${flags.map((f) => (f ? 'A' : '-')).join('')})`,
      ).toBe(true);
    });

    test('the Allocated tab lists only active members and its heading counts them @ui', async ({
      page,
    }) => {
      await openWithMembers(page);
      await channelTab(page, 'Allocated').click();
      const count = await headingCount(page, /(Channels|Members) Allocated\s*\(/);
      const rows = memberRows(page);
      await expect(rows, `the Allocated heading says ${count}`).toHaveCount(count);
      await expect
        .soft(rows.filter({ hasNot: page.locator('.phoneno') }), 'every allocated row is active')
        .toHaveCount(0);
    });

    test('the Unallocated tab lists only inactive members and its heading counts them @ui', async ({
      page,
    }) => {
      await openWithMembers(page);
      await channelTab(page, 'Unallocated').click();
      const count = await headingCount(page, /(Channels Unallocated|On Hold Members)\s*\(/);
      const rows = memberRows(page);
      await expect(rows, `the Unallocated heading says ${count}`).toHaveCount(count);
      await expect
        .soft(rows.filter({ has: page.locator('.phoneno') }), 'no unallocated row is active')
        .toHaveCount(0);
    });

    test("opening a member shows that member's Digital Card and closing it changes nothing @ui", async ({
      page,
    }) => {
      const rows = await openWithMembers(page);
      const total = await rows.count();
      const row = rows.filter({ has: page.locator('.phoneno') }).first();
      const active = await row.isVisible().catch(() => false);
      test.skip(!active, 'no active member to open');
      const names = (await row.locator('.license, .lesssize').allInnerTexts())
        .map((t) => t.trim())
        .filter((t) => t && !t.startsWith('+91'));

      const actions: string[] = [];
      page.on('request', (req) => {
        if (/terminate|resetpassword|allocate|deactivat/i.test(req.url())) actions.push(req.url());
      });

      await row.click();
      const card = page.locator('.dc-shell').first();
      await expect(card, "the member's Digital Card opens").toBeVisible({ timeout: 15_000 });
      const cardText = (await card.innerText()).toLowerCase();
      expect
        .soft(
          names.some((n) => cardText.includes(n.toLowerCase())),
          `the card belongs to the member clicked (${names.join(' / ')})`,
        )
        .toBe(true);

      await page.keyboard.press('Escape');
      await expect(card, 'Escape closes the card').toBeHidden({ timeout: 10_000 });
      await expect(rows, 'the member list is unchanged after closing the card').toHaveCount(total);
      expect(actions, 'opening and closing a card sends no member action').toEqual([]);
    });
  },
);
