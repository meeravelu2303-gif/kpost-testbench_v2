import { STORAGE_STATE_BUSINESS } from '@config/constants';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Settings · Small Business Settings → Business Bank Account Details (`BankDetails.js`, BUSINESS_S
 * admin only). Confirmed from source: adding a bank record calls a real
 * `UpdateBankAccountDetails` -> `POST /v2/admin/updateBankAccountDetails/`, but the per-record
 * "Delete" button is CLIENT-SIDE ONLY (its own code comment says `// confirm and delete API` — no
 * actual delete endpoint is wired). That means completing a real "Add" here would leave a permanent
 * bank record with NO confirmed way to remove it through the UI — so this test deliberately stops
 * short of the final Submit, matching the same conservative boundary as `settings-change-password` /
 * `settings-delete-account`. It DOES exercise the real, safe-to-repeat IFSC lookup behavior, stubbed
 * to avoid depending on the live third-party `ifsc.razorpay.com` API during automated runs.
 */
test.describe('KPost Settings · Business Bank Account Details (BUSINESS_S, validation only)', { tag: '@ui' }, () => {
  test.use({ storageState: STORAGE_STATE_BUSINESS });

  test.skip(
    process.env.BUSINESS_UI_LIFECYCLE !== 'true',
    'needs the BUSINESS_S admin session; set BUSINESS_UI_LIFECYCLE=true',
  );
  test.skip(
    !testData.businessSKpostId || testData.businessSKpostId.includes('qa.business'),
    'needs the BUSINESS_S account (QA_BUSINESS_S_KPOST_ID)',
  );

  test('entering an 11-character IFSC code auto-fires a lookup, and Submit stays gated until every field is filled @ui', async ({
    page,
    settingsPage,
  }) => {
    // Stub the third-party lookup so the test never depends on ifsc.razorpay.com's real availability.
    await page.route('https://ifsc.razorpay.com/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ BANK: 'QA Test Bank', BRANCH: 'QA Branch', CITY: 'QA City' }),
      }),
    );

    await settingsPage.goto();
    await settingsPage.openPanel('Small Business Settings', 'Business Bank Account Details');

    const addButton = page.getByText(/Add New Bank Details/i).first();
    await expect(addButton, 'the panel renders with an Add New Bank Details control').toBeVisible({
      timeout: 15_000,
    });
    await addButton.click();

    const submitButton = page.getByRole('button', { name: /^Submit$/i });
    await expect(submitButton, 'Submit starts disabled with an empty form').toBeDisabled({
      timeout: 10_000,
    });

    await page.getByPlaceholder('Enter Bank Account Number').fill('123456789012');
    await page.getByPlaceholder('Enter Account Holder Name').fill('QA Bench Tester');

    const ifscRequestPromise = page.waitForRequest((req) => req.url().includes('ifsc.razorpay.com'), {
      timeout: 10_000,
    });
    await page.getByPlaceholder('Enter IFSC Code').fill('QABK0001234');
    const ifscRequest = await ifscRequestPromise;
    expect(ifscRequest, 'an 11-character IFSC code auto-fires the lookup').toBeTruthy();

    await expect(
      page.getByText(/IFSC Code Verification/i).first(),
      'the IFSC verification modal opens with the stubbed bank details',
    ).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /^Ok$/i }).first().click();

    await page.getByPlaceholder('Enter Bank Name').fill('QA Test Bank');
    await page.getByPlaceholder('Enter Branch Name').fill('QA Branch');

    await expect(
      submitButton,
      'Submit becomes enabled once all 5 fields are filled — NOT clicked: there is no confirmed ' +
        'delete API to clean up a real bank record afterward',
    ).toBeEnabled({ timeout: 10_000 });

    await page.getByRole('button', { name: /^Cancel$/i }).first().click();
  });
});
