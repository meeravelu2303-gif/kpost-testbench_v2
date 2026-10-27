import { STORAGE_STATE_BUSINESS } from '@config/constants';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import {
  chooseDesignation,
  MOBILE_FIELD,
  openAddChannelsChooser,
  openAddMemberForm,
  openUserManagement,
} from '../support/usermanagement';

/**
 * BUSINESS_S User Management screen (`/usermanagement`), gated behind BUSINESS_UI_LIFECYCLE=true.
 * Read-only: it never completes Add, which would provision a real member account.
 */
test.describe(
  'KPost company-admin · User Management (BUSINESS_S)',
  { tag: ['@ui', '@user-management', '@regression', '@sanity'] },
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

    test('the Business User Management workspace renders licences + members @ui', async ({
      page,
    }) => {
      await openUserManagement(page);
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
      // Stops at the chooser: completing it provisions a real member account.
      await openAddChannelsChooser(page);
      await expect(
        page.getByText(/Add Manually/i).first(),
        'the chooser offers Add Manually',
      ).toBeVisible();
      await expect(
        page.getByText(/Bulk-?Upload/i).first(),
        'the chooser offers Bulk-Upload',
      ).toBeVisible();
    });

    /**
     * One company must never have two members with the same mobile (other companies may share it).
     * Never reaches ADD, so nothing is provisioned.
     */
    test('adding a member with a mobile already used in THIS company is rejected @ui', async ({
      page,
    }) => {
      const modal = await openAddMemberForm(page);

      // An existing member's mobile, read off the member list behind the modal, guarantees a collision.
      const listedMobile = await page
        .getByText(/\+91\s?\d{10}/)
        .first()
        .textContent();
      const digitsOnly = (listedMobile ?? '').replace(/\D/g, '').slice(-10);
      test.skip(
        digitsOnly.length !== 10,
        'no member mobile number was listed on the page right now — nothing to collide with',
      );

      // Designation first: the form only enables Mobile No once a designation is chosen.
      await chooseDesignation(page, modal, 'Accounts Officer');
      const mobileField = modal.getByPlaceholder(MOBILE_FIELD);
      await expect(mobileField, 'Mobile No enables once a Designation is chosen').toBeEnabled({
        timeout: 10_000,
      });

      const firstName = modal.getByPlaceholder('Enter First Name');
      await expect(firstName, 'First Name is editable before any mobile is typed').toBeEnabled();

      await mobileField.pressSequentially(digitsOnly, { delay: 20 });

      await expect(
        modal.getByText(/Mobile number already exists/i),
        'reusing a mobile already registered to another member of THIS company is rejected',
      ).toBeVisible({ timeout: 10_000 });
      await expect(
        firstName,
        'the rest of the form stays blocked while the mobile collision is unresolved',
      ).toBeDisabled();
      await expect(
        modal.getByRole('button', { name: /^ADD$/ }),
        'ADD stays disabled while the collision is unresolved',
      ).toBeDisabled();
    });
  },
);
