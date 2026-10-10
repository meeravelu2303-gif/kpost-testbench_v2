import { STORAGE_STATE_BUSINESS } from '@config/constants';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import {
  chooseDesignation,
  MOBILE_FIELD,
  openAddChannelsChooser,
  openAddMemberForm,
  openUserManagement,
} from './support/usermanagement';

/**
 * **Company-admin UI** — the BUSINESS_S in-app **User Management** screen (`/usermanagement`), which a
 * PERSONAL account does not have. Runs in the BUSINESS_S admin session (`.auth/business.json`, from
 * `auth-business.setup.ts`), so the whole spec is gated behind `BUSINESS_UI_LIFECYCLE=true` (the
 * session is only a real login then). See `docs/modules/admin-flow.md` §3.
 *
 * Read-only: it asserts the Business User Management workspace, the licence summary and the member
 * list render, and that **Add New Channels** opens its "Add Communication Channels" chooser (Add
 * Manually / Bulk-Upload). It STOPS there — completing the add flow **provisions a real KPost member
 * account** (external side effect, `addingUserByAdmin`), which is covered gated at the API level.
 */
test.describe('KPost company-admin · User Management (BUSINESS_S)', { tag: '@ui' }, () => {
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
    // The chooser modal: Add Manually · Bulk-Upload MS Excel File. We STOP here (completing it
    // provisions a real member account).
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
   * The rule (confirmed with the product owner, 2026-09-29): one mobile number MAY belong to
   * multiple Business accounts across DIFFERENT companies, but the SAME company must never have two
   * members sharing one mobile number. Verified here via the real, front-door admin UI — no API
   * bypass needed and none was used. Entering an existing member's own mobile number
   * (`POST /v2/common/mobileNoExistInsideCompany/`) correctly shows "Mobile number already exists!"
   * and blocks the rest of the form (First Name stays disabled) — confirmed live, this rule works.
   *
   * Read-only in effect: it deliberately never reaches ADD, so it never provisions a real member —
   * safe to run unattended, unlike completing the flow (see the note on the test above).
   *
   * Re-tuned live 2026-10-10. This test had been SKIPPING on every run ("the Mobile No field did
   * not enable"): the field's placeholder had changed to "Enter 10-digit Mobile No (country code
   * optional)", so the old selector matched nothing, and the forced click + fixed sleeps around the
   * Designation picker hid that. Re-verified by hand the same day: the collision message appears,
   * First Name locks while it shows, and a fresh number clears it again.
   */
  test('adding a member with a mobile already used in THIS company is rejected @ui', async ({
    page,
  }) => {
    const modal = await openAddMemberForm(page);

    // Any existing member's own mobile, read straight off the rendered member list (still in the
    // DOM behind the modal), is the least brittle way to guarantee a genuine same-company collision.
    const listedMobile = await page
      .getByText(/\+91\s?\d{10}/)
      .first()
      .textContent();
    const digitsOnly = (listedMobile ?? '').replace(/\D/g, '').slice(-10);
    test.skip(digitsOnly.length !== 10, 'could not read a real member mobile number off the page');

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
});
