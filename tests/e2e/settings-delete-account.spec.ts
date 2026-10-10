import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Settings · Delete Account panel (`Deleteaccount.js`) — the single most destructive, irreversible
 * flow in the entire app: its terminal action (`DeactivateMyAccount` -> `POST
 * /v2/profile/deactivateAccount/`) permanently deactivates the account and purges the whole local
 * session. Getting there requires a REAL OTP send (`AccountDeactivationOtp` ->
 * `GET /v2/profile/sendAccountDeactivationOtp/`) as early as step 1's "Confirm" button.
 *
 * HARD SAFETY BOUNDARY, same rigor as K-Booking's payment flow: this test suite NEVER clicks
 * "Confirm" on the reason-selection screen, because that alone fires a real OTP-send call against
 * whichever account is signed in. There is no dedicated disposable "delete me" account, and even
 * requesting the OTP is a real, unnecessary side effect against a shared QA account. Scope is
 * strictly the reason-selection UI, which is genuinely safe: it never leaves local state.
 */
test.describe(
  'KPost Settings · Delete Account panel (reason selection only — never confirms)',
  { tag: '@ui' },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    test('the reason-selection screen renders its options, and choosing "Others" reveals a free-text reason @ui', async ({
      page,
      settingsPage,
    }) => {
      await settingsPage.goto();
      await settingsPage.openPanel('My Account', 'Delete My Account');

      let deactivationRequestFired = false;
      page.on('request', (req) => {
        if (req.url().includes('/profile/sendAccountDeactivationOtp'))
          deactivationRequestFired = true;
        if (req.url().includes('/profile/deactivateAccount')) deactivationRequestFired = true;
      });

      await expect(
        page.getByText(/I don.t want to use anymore/i).first(),
        'the first delete-reason option renders',
      ).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(/I.m using another account/i).first()).toBeVisible();
      await expect(page.getByText(/Application is not friendly/i).first()).toBeVisible();

      const othersOption = page.getByText(/^Others$/i).first();
      await expect(othersOption, 'the "Others" option renders').toBeVisible();
      await othersOption.click();

      const reasonField = page.getByPlaceholder(/Write your Reason/i).first();
      await expect(reasonField, 'choosing "Others" reveals a free-text reason field').toBeVisible({
        timeout: 10_000,
      });
      await reasonField.fill('QA UI test — reason-selection render check only, never confirmed');

      // The safety boundary: confirm the Confirm button exists (proving the panel is fully reachable
      // and usable) WITHOUT EVER CLICKING IT — clicking it fires a real account-deactivation OTP send.
      await expect(
        page.getByRole('button', { name: /^Confirm$/i }).first(),
        'the Confirm control is present — NOT clicked, since it fires a real OTP send',
      ).toBeVisible();

      expect(
        deactivationRequestFired,
        'reason selection alone (never clicking Confirm) must never reach the account-deactivation API',
      ).toBe(false);
    });
  },
);
