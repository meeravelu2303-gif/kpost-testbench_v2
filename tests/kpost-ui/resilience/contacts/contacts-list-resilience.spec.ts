import { testData } from '@config/test-data.config';
import { healthFailures, isResponsive, watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';
import { contactsSearchBox, gotoContacts } from '../../support/contacts';
import { retryOrSkip } from '../../../support/live-condition';

/**
 * Katchup › Contacts under a bad network: a slow contacts load still lists contacts, going offline
 * keeps the list usable (search filters locally) and it reloads once back online, a reload while the
 * load is out recovers, and rapid Recents/Contacts tab switching neither crashes nor duplicates rows.
 * The list comes from POST /contacts/myContacts/ (MenuRoutes.js, Services/Contacts.js GetMyContacts);
 * rows are `.Bar-Name` (as contacts-functional). Read-only: nothing is written.
 */
const MY_CONTACTS = '**/contacts/myContacts/**';
const BOUNDARY = /Something went wrong/i;
const SKIP_REASON =
  'the Contacts panel was not showing right now (a session or load condition, not a Contacts defect)';
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test.describe(
  'KPost Contacts · contact list under a slow or lost network',
  {
    tag: ['@ui', '@contacts', '@regression'],
    annotation: [{ type: 'non-functional', description: 'resilience' }],
  },
  () => {
    test.describe.configure({ timeout: 180_000 });
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real QA account (QA_KPOST_ID)',
    );

    test('a slow contacts load still lists the contacts when it arrives @ui', async ({ page }) => {
      await page.route(MY_CONTACTS, async (route) => {
        await delay(6_000);
        await route.continue().catch(() => undefined);
      });
      const opened = await gotoContacts(page);
      retryOrSkip(!opened, SKIP_REASON);
      await expect
        .poll(() => page.locator('.Bar-Name:visible').count(), {
          message: 'the contacts are listed once the slow load answers (no stuck empty list)',
          timeout: 45_000,
        })
        .toBeGreaterThan(0);
      await expect(page.getByText(BOUNDARY), 'no error boundary').toHaveCount(0);
    });

    test('offline, the list still filters locally; back online it reloads @ui', async ({
      page,
      context,
    }) => {
      const opened = await gotoContacts(page);
      retryOrSkip(!opened, SKIP_REASON);
      const names = page.locator('.Bar-Name:visible');
      await expect
        .poll(() => names.count(), { message: 'the contacts are listed', timeout: 20_000 })
        .toBeGreaterThan(0);
      const before = await names.count();
      const stop = watchUiHealth(page);
      await context.setOffline(true);
      try {
        const search = contactsSearchBox(page);
        await search.click();
        await search.fill('zzzzzznomatch');
        await expect
          .poll(() => names.count(), {
            message: 'the search filters the list while offline',
            timeout: 10_000,
          })
          .toBeLessThan(before);
        await search.fill('');
        await expect(page.getByText(BOUNDARY), 'no error boundary while offline').toHaveCount(0);
        expect(await isResponsive(page), 'the list does not freeze offline').toBe(true);
      } finally {
        await context.setOffline(false);
      }
      const back = await gotoContacts(page);
      expect(back, 'the Contacts panel comes back once online').toBe(true);
      await expect
        .poll(() => names.count(), { message: 'the contacts list again', timeout: 30_000 })
        .toBeGreaterThan(0);
      expect(healthFailures(stop()), 'no crash across offline and back').toEqual([]);
    });

    test('a reload while the contacts load is out recovers the list @ui', async ({ page }) => {
      let first = true;
      await page.route(MY_CONTACTS, async (route) => {
        if (first) {
          first = false;
          await delay(15_000);
        }
        await route.continue().catch(() => undefined);
      });
      await page.goto('/katchup', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await expect.poll(() => first, { message: 'the contacts load went out' }).toBe(false);
      const stop = watchUiHealth(page);
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 });
      const opened = await gotoContacts(page);
      expect(opened, 'the Contacts panel comes back after the reload').toBe(true);
      await expect
        .poll(() => page.locator('.Bar-Name:visible').count(), {
          message: 'the contacts list after the reload',
          timeout: 30_000,
        })
        .toBeGreaterThan(0);
      await expect(page.getByText(BOUNDARY), 'no error boundary after the reload').toHaveCount(0);
      expect(stop().pageErrors, 'no uncaught error after the reload').toEqual([]);
    });

    test('switching Recents and Contacts quickly neither crashes nor duplicates contacts @ui', async ({
      page,
    }) => {
      const opened = await gotoContacts(page);
      retryOrSkip(!opened, SKIP_REASON);
      const names = page.locator('.Bar-Name:visible');
      await expect
        .poll(() => names.count(), { message: 'the contacts are listed', timeout: 20_000 })
        .toBeGreaterThan(0);
      const before = await names.count();
      const stop = watchUiHealth(page);
      const contactsTab = page.getByRole('tab', { name: 'Contacts' });
      // KatchupPage.js renders a second, hidden tab strip; act on the visible one.
      const recentsTab = page
        .getByRole('tab', { name: 'Recents' })
        .filter({ visible: true })
        .first();
      for (let i = 0; i < 5; i++) {
        await recentsTab.click();
        await contactsTab.click();
      }
      await expect(contactsSearchBox(page), 'the Contacts panel is showing').toBeVisible({
        timeout: 15_000,
      });
      await expect
        .poll(() => names.count(), {
          message: 'the same number of contacts after rapid switching (no duplicates, none lost)',
          timeout: 15_000,
        })
        .toBe(before);
      await expect(page.getByText(BOUNDARY), 'no error boundary').toHaveCount(0);
      expect(stop().pageErrors, 'no uncaught error while switching tabs').toEqual([]);
    });
  },
);
