import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { gotoContacts, openPeopleSearch } from '../support/contacts';
import { toast } from '../support/validation';

/**
 * KDirectory (KdirectoryModal.js): adding a directory entry to the contacts when the server
 * refuses is reported. The search is answered in the browser with one made-up entry (so a not-yet-
 * added row is always there) and /contacts/addContact/ is failed in the browser, so nobody is
 * added.
 */
const SEED = {
  kpostID: 'qa.bench.directory.seed@kpostindia.com',
  firstName: 'Qatest',
  lastName: 'Directoryseed',
  fullName: 'Qatest Directoryseed',
  designation: null,
  city: 'Chennai',
  userType: 'PERSONAL',
  isAdded: false,
};

test.describe(
  'KPost KDirectory · an add-to-contacts the server refuses is reported',
  {
    tag: ['@ui', '@kdirectory', '@regression'],
    annotation: [{ type: 'non-functional', description: 'resilience' }],
  },
  () => {
    test.describe.configure({ timeout: 120_000 });
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real QA account (QA_KPOST_ID)',
    );

    test('Add To Contact › Add the server refuses says "Adding Contact Failed"', async ({
      page,
    }) => {
      let refused = 0;
      await page.route('**/contacts/globalSearch/**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'SUCCESS', statusCode: 200, data: [SEED] }),
        }),
      );
      await page.route('**/contacts/addContact/**', (route) => {
        refused += 1;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'FAILURE', statusCode: 400, message: '' }),
        });
      });
      expect(await gotoContacts(page), 'the Contacts tab opens').toBe(true);
      const search = await openPeopleSearch(page);
      expect(search, 'the directory search renders').not.toBeNull();
      await search!.fill('Qatest');
      const row = page
        .locator('.contactDir_scrollHeight > div')
        .filter({ hasText: SEED.fullName })
        .first();
      await expect(row, 'the made-up entry is listed').toBeVisible({ timeout: 20_000 });
      await row.locator('input[type="checkbox"]').first().check();
      await page
        .getByRole('button', { name: 'Add To Contact', exact: true })
        .filter({ visible: true })
        .first()
        .click();
      await expect(
        page.getByText('Do you want to add to your KPOST Contacts?'),
        'the add confirmation opens',
      ).toBeVisible({ timeout: 10_000 });
      await page
        .getByRole('button', { name: 'Add', exact: true })
        .filter({ visible: true })
        .last()
        .click();
      await expect(toast(page, 'Adding Contact Failed'), 'the user is told').toBeVisible({
        timeout: 10_000,
      });
      expect(refused, 'the add was answered in the browser').toBeGreaterThanOrEqual(1);
    });
  },
);
