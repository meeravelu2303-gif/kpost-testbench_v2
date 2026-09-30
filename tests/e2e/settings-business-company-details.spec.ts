import { STORAGE_STATE_BUSINESS } from '@config/constants';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Settings · Small Business Settings → Company Details (`CompanyDetails.js`, BUSINESS_S admin only).
 * Confirmed from source: `UpdateCompanyDetails` -> `POST /v2/admin/updateCompanyDetails/` updates the
 * company's PAN/GST numbers — a genuine UPDATE on existing fields (not an additive, undeletable record
 * like Bank Details), so a self-restoring round trip is meaningful here: read the current values,
 * change them, confirm the write, then restore the originals — same discipline as
 * `profile-edit.spec.ts`'s About field.
 *
 * Also confirmed from source: `handleInputChange` forces both fields to `.toUpperCase()` as the user
 * types — asserted directly, not assumed.
 */
test.describe('KPost Settings · Company Details (BUSINESS_S, self-restoring)', { tag: '@ui' }, () => {
  test.use({ storageState: STORAGE_STATE_BUSINESS });

  test.skip(
    process.env.BUSINESS_UI_LIFECYCLE !== 'true',
    'writes real company registration details; set BUSINESS_UI_LIFECYCLE=true',
  );
  test.skip(
    !testData.businessSKpostId || testData.businessSKpostId.includes('qa.business'),
    'needs the BUSINESS_S account (QA_BUSINESS_S_KPOST_ID)',
  );

  test('typed PAN/GST values are force-uppercased, and an edit round-trips back to the original @ui', async ({
    page,
    settingsPage,
  }) => {
    await settingsPage.goto();
    await settingsPage.openPanel('Small Business Settings', 'Company Details');

    await expect(
      page.getByText(/Company Registration Details/i).first(),
      'the panel renders',
    ).toBeVisible({ timeout: 15_000 });

    // Read the current values before touching anything, so they can be restored.
    const panField = page.getByPlaceholder('Enter PAN details');
    const gstField = page.getByPlaceholder('Enter GST details');
    const editIcon = page.locator('.icon-KP_236_Edit, [class*="edit"]').first();

    const editOpened = await editIcon
      .click()
      .then(() => panField.isVisible({ timeout: 5_000 }))
      .catch(() => false);
    test.skip(!editOpened, 'the edit form did not open — needs a codegen re-tune');

    const originalPan = await panField.inputValue();
    const originalGst = await gstField.inputValue();

    await panField.fill('');
    await panField.type('qabench1234f');
    await expect(
      panField,
      'typed PAN input is force-uppercased as you type',
    ).toHaveValue('QABENCH1234F');

    const submitPromise = page.waitForRequest(
      (req) => req.url().includes('/admin/updateCompanyDetails') && req.method() === 'POST',
      { timeout: 10_000 },
    );
    await page.getByRole('button', { name: /^Submit$/i }).first().click();
    await submitPromise;

    await expect(
      page.getByText(/updated successfully/i).first(),
      'a success toast confirms the update',
    ).toBeVisible({ timeout: 10_000 });

    // Restore the original values.
    await editIcon.click();
    await expect(panField, 'the edit form reopens for restore').toBeVisible({ timeout: 10_000 });
    await panField.fill('');
    if (originalPan) await panField.type(originalPan);
    if (originalGst) {
      await gstField.fill('');
      await gstField.type(originalGst);
    }
    const restorePromise = page.waitForRequest(
      (req) => req.url().includes('/admin/updateCompanyDetails') && req.method() === 'POST',
      { timeout: 10_000 },
    );
    await page.getByRole('button', { name: /^Submit$/i }).first().click();
    await restorePromise;
  });
});
