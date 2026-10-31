import { expect, test } from '@fixtures';

/**
 * Login: an Indian mobile under a +44 country selection must not resolve the account. The mobile
 * comes from QA_LOGIN_MISMATCH_MOBILE (personal data); the test stops at the lookup.
 */
const MISMATCH_MOBILE = process.env.QA_LOGIN_MISMATCH_MOBILE;
const MISMATCH_COUNTRY = process.env.QA_LOGIN_MISMATCH_COUNTRY || 'United Kingdom';

test.describe(
  'KPost UI · login country must constrain the mobile lookup',
  { tag: ['@ui', '@auth', '@regression'] },
  () => {
    test.use({ storageState: { cookies: [], origins: [] } });
    test.skip(
      !MISMATCH_MOBILE,
      'set QA_LOGIN_MISMATCH_MOBILE to a registered India mobile to exercise the country/number mismatch',
    );

    test(
      'a non-matching country + mobile number must not resolve an account @ui',
      { annotation: [{ type: 'requirement', description: 'FR-SL-023' }] },
      async ({ page }) => {
        await page.goto('/login', { waitUntil: 'domcontentloaded', timeout: 45_000 });
        const idInput = page.locator('#username');
        await expect(idInput).toBeEnabled({ timeout: 30_000 });

        // Select the mismatching country (default: United Kingdom, +44).
        await page
          .getByText(/Search country/i)
          .first()
          .click()
          .catch(() => undefined);
        await page.keyboard.type(MISMATCH_COUNTRY);
        await page.waitForTimeout(800);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(500);

        // Enter the India-registered mobile and press the Submit button (not Enter).
        await idInput.fill(MISMATCH_MOBILE as string);
        await page.getByRole('button', { name: /^Submit$/i }).click();
        await page.waitForTimeout(4000);

        const channelDialog = page.getByText(/Select a KPOST Channel/i);
        const passwordStep = page.locator('input[type="password"]');
        const proceeded =
          (await channelDialog
            .first()
            .isVisible()
            .catch(() => false)) ||
          (await passwordStep
            .first()
            .isVisible()
            .catch(() => false));

        expect(
          proceeded,
          `a ${MISMATCH_COUNTRY} (non-India) country with an Indian mobile number must NOT resolve an ` +
            `account — the app proceeded (channel picker / password step shown), so the login lookup ` +
            `ignores the selected country`,
        ).toBe(false);
      },
    );
  },
);
