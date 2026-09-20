import { env } from '@config/env';
import { STORAGE_STATE_BUSINESS } from '@config/constants';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * **Company-admin UI** — the BUSINESS_S in-app **User Management** screen (`/usermanagement`), which a
 * PERSONAL account does not have. Runs in the BUSINESS_S admin session (`.auth/business.json`, from
 * `auth-business.setup.ts`), so the whole spec is gated behind `BUSINESS_UI_LIFECYCLE=true` (the
 * session is only a real login then). See `docs/admin-flow.md` §3.
 *
 * Read-only: it asserts the Business User Management workspace, the licence summary and the member
 * list render, and that **Add New Channels** opens its "Add Communication Channels" chooser (Add
 * Manually / Bulk-Upload). It STOPS there — completing the add flow **provisions a real KPost member
 * account** (external side effect, `addingUserByAdmin`), which is covered gated at the API level.
 */
test.describe('KPost company-admin · User Management (BUSINESS_S)', { tag: '@ui' }, () => {
  test.use({ storageState: STORAGE_STATE_BUSINESS });

  test.skip(
    !env.BUSINESS_UI_LIFECYCLE,
    'needs the BUSINESS_S admin session; set BUSINESS_UI_LIFECYCLE=true',
  );
  test.skip(
    !testData.businessSKpostId || testData.businessSKpostId.includes('qa.business'),
    'needs the BUSINESS_S account (QA_BUSINESS_S_KPOST_ID)',
  );

  test('the Business User Management workspace renders licences + members @ui', async ({
    page,
  }) => {
    await page.goto('/usermanagement', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page
      .locator('.loader-overlay')
      .waitFor({ state: 'hidden', timeout: 30_000 })
      .catch(() => undefined);

    await expect(
      page.getByText(/Business User Management/i).first(),
      'the User Management workspace renders',
    ).toBeVisible({ timeout: 20_000 });
    // The licence summary and channel counts (the business-tier accounting).
    await expect(
      page.getByText(/Total Licenses|Free Licenses|Channels/i).first(),
      'the licence / channel summary renders',
    ).toBeVisible({ timeout: 20_000 });
    // The member list carries the admin's own row (Admin badge) — the company's members.
    await expect(
      page.getByText(/Admin/i).first(),
      'the company members list renders (admin row)',
    ).toBeVisible({ timeout: 20_000 });
  });

  test('Add New Channels opens the Add Communication Channels chooser @ui', async ({ page }) => {
    await page.goto('/usermanagement', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page
      .locator('.loader-overlay')
      .waitFor({ state: 'hidden', timeout: 30_000 })
      .catch(() => undefined);

    await page
      .getByText(/Add New\s*\d*\s*Channels/i)
      .first()
      .click();

    // The chooser modal: Add Manually · Bulk-Upload MS Excel File. We STOP here (completing it
    // provisions a real member account).
    await expect(
      page.getByText(/Add Manually|Bulk-?Upload/i).first(),
      'the Add Communication Channels chooser opens',
    ).toBeVisible({ timeout: 15_000 });
  });
});
