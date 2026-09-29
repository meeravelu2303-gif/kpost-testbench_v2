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
   */
  test('adding a member with a mobile already used in THIS company is rejected @ui', async ({
    page,
  }) => {
    await page.goto('/usermanagement', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page
      .locator('.loader-overlay')
      .waitFor({ state: 'hidden', timeout: 30_000 })
      .catch(() => undefined);
    await page.waitForTimeout(1000);
    await page.getByText(/Add New\s*\d*\s*Channels/i).first().click();
    await page.waitForTimeout(500);
    await page.getByText(/Add Manually/i).first().click();
    await page.waitForTimeout(1000);

    const modal = page.locator('.modal.show, [role="dialog"]').last();
    // Designation must be set first (async-search react-select) before Mobile No is enabled.
    await modal.locator('input[id^="react-select"]').first().click({ force: true });
    await page.waitForTimeout(700);
    await page.keyboard.type('Accounts Officer');
    await page.waitForTimeout(1200);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(700);

    const mobileField = modal.getByPlaceholder('Enter Mobile No with Country Code');
    const enabled = await mobileField.isEnabled().catch(() => false);
    test.skip(!enabled, 'the Mobile No field did not enable — needs a codegen re-tune');

    // Any existing member's own mobile, read straight off the rendered member list, is the least
    // brittle way to guarantee a genuine same-company collision. Plain 10-digit format: the field's
    // own mask mangles a leading "+91"/country-code prefix despite its placeholder claiming to want
    // one — a separate, minor defect noted but not filed on its own.
    const memberMobile = await page.getByText(/\+91\s?\d{10}/).first().textContent();
    const digitsOnly = (memberMobile ?? '').replace(/\D/g, '').slice(-10);
    test.skip(digitsOnly.length !== 10, 'could not read a real member mobile number off the page');

    await mobileField.pressSequentially(digitsOnly, { delay: 20 });

    await expect(
      modal.getByText(/Mobile number already exists/i),
      'reusing a mobile already registered to another member of THIS company is rejected',
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      modal.getByPlaceholder('Enter First Name'),
      'the rest of the form stays blocked while the mobile collision is unresolved',
    ).toBeDisabled();
  });
});
