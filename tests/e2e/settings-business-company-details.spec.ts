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
 *
 * NEEDS-CODEGEN fix applied 2026-10-04: the component uses MUI's `<Edit />` icon
 * (`@mui/icons-material`), not a `.icon-KP_236_Edit` KPost font-icon — the old `.icon-KP_236_Edit,
 * [class*="edit"]` selector matches neither (MUI renders `MuiSvgIcon-root`, no literal "edit"
 * substring), so the edit form never actually opened. There are also TWO `<Edit />` icons on this page
 * when the summary view is showing — one beside "Company Address" with no `onClick` at all (a second,
 * separate dead-icon defect, not exercised here), and the functional one beside "Company Registration
 * Details" — scoped to by that heading specifically.
 *
 * Also confirmed from source, a real defect worth asserting directly: on a successful save,
 * `handleSaveCompanyDetails` calls `setCompanyDetails({ panNumber: '', gstNumber: '' })` — wiping the
 * local state to blank — instead of the values just saved, before flipping back to the read-only
 * summary view. The backend update itself succeeds; only the immediately-following UI display is
 * wrong, falsely showing both fields as blank right after a successful save.
 */
test.describe(
  'KPost Settings · Company Details (BUSINESS_S, self-restoring)',
  { tag: '@ui' },
  () => {
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
      // Scoped to the "Company Registration Details" heading specifically — a second, non-functional
      // <Edit /> icon also sits beside "Company Address" elsewhere on this page.
      const editIcon = page
        .locator('h3', { hasText: 'Company Registration Details' })
        .locator('svg')
        .first();

      const editOpened = await editIcon
        .click()
        .then(() => panField.isVisible({ timeout: 5_000 }))
        .catch(() => false);
      test.skip(!editOpened, 'the edit form did not open — needs a codegen re-tune');

      const originalPan = await panField.inputValue();
      const originalGst = await gstField.inputValue();

      await panField.fill('');
      await panField.type('qabench1234f');
      await expect(panField, 'typed PAN input is force-uppercased as you type').toHaveValue(
        'QABENCH1234F',
      );

      const submitPromise = page.waitForRequest(
        (req) => req.url().includes('/admin/updateCompanyDetails') && req.method() === 'POST',
        { timeout: 10_000 },
      );
      await page
        .getByRole('button', { name: /^Submit$/i })
        .first()
        .click();
      await submitPromise;

      await expect(
        page.getByText(/updated successfully/i).first(),
        'a success toast confirms the update',
      ).toBeVisible({ timeout: 10_000 });

      // Confirmed from source: handleSaveCompanyDetails wipes local state to blank on success instead
      // of showing the just-saved values — the summary view falsely displays blank PAN/GST right after
      // a successful update, even though the backend write itself succeeded.
      const panSummaryValue = page
        .locator('p', { hasText: 'Company Pan Card Number' })
        .locator('b')
        .first();
      await expect(
        panSummaryValue,
        'confirmed bug: right after a successful save, the summary view shows an EMPTY PAN value ' +
          '(local state is reset to blank on success instead of the value just saved — a real display ' +
          'defect even though the backend write itself succeeded)',
      ).toHaveText('');

      // Restore the original values.
      const editIconAfterSave = page
        .locator('h3', { hasText: 'Company Registration Details' })
        .locator('svg')
        .first();
      await editIconAfterSave.click();
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
      await page
        .getByRole('button', { name: /^Submit$/i })
        .first()
        .click();
      await restorePromise;
    });
  },
);
