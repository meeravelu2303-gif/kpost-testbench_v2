import { STORAGE_STATE_BUSINESS, TAGS } from '@config/constants';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { openUserManagement } from '../support/usermanagement';
import { requireFlags, waitLoaded } from './support/journey';

/**
 * Journey 9: the BUSINESS_S admin opens User Management (licences, members), then Katchup, then Home.
 * Read-only: adding a member provisions real external accounts. User Management sometimes bounces to
 * /home; openUserManagement fails loudly on it.
 */
test.describe(
  'JOURNEY 9 · running a company account',
  { tag: [TAGS.ui, TAGS.journey, TAGS.userManagement, TAGS.regression] },
  () => {
    test.describe.configure({ timeout: 150_000 });
    test.use({ storageState: STORAGE_STATE_BUSINESS });
    requireFlags('BUSINESS_UI_LIFECYCLE');
    test.skip(
      !testData.businessSKpostId || testData.businessSKpostId.includes('qa.business'),
      'needs the BUSINESS_S company admin account (QA_BUSINESS_S_KPOST_ID)',
    );

    test('the company admin reviews licences and members, then carries on in the app', async ({
      page,
    }) => {
      await test.step('lands on Home', async () => {
        await page.goto('/home', { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await waitLoaded(page);
        await expect(page, 'the company admin is signed in').toHaveURL(/\/home/);
      });

      await test.step('opens User Management and sees licences and members', async () => {
        await openUserManagement(page);
        await expect(
          page.getByText(/Total Licenses|Free Licenses|Channels/i).first(),
          'the licence summary shows',
        ).toBeVisible({ timeout: 20_000 });
        await expect(
          page.getByText(/\+91\s?\d{10}/).first(),
          'at least one member is listed with their mobile number',
        ).toBeVisible({ timeout: 20_000 });
      });

      await test.step('moves on to Katchup, still signed in as the company admin', async () => {
        await page.goto('/katchup', { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await waitLoaded(page);
        await expect(page, 'Katchup opens for the company admin').toHaveURL(/\/katchup/);
      });

      await test.step('returns Home', async () => {
        await page.goto('/home', { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await expect(page, 'still signed in at the end').toHaveURL(/\/home/);
      });
    });
  },
);
