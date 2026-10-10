import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Settings · Change Password panel (`Changepassword.js`) — this DOES call a real backend endpoint
 * (`changePasswordApi` -> `POST /v2/profile/changePassword`) and, on success, force-logs-out the
 * account. Unlike the forgot-password flow (which has its own dedicated spare account,
 * `QA_FORGOT_PASSWORD_KPOST_ID`), no spare account exists for THIS in-app flow, which additionally
 * requires the CURRENT password matched against Redux state before it even reaches the API — there is
 * no safe way to complete it against any account this bench manages. So this file deliberately never
 * clicks the final "Submit" that fires the real API call; it only exercises the extensive CLIENT-SIDE
 * validation, which is itself real, substantial surface:
 *
 *  - Old Password step gates on a Redux-stored password comparison (client-side, no API) before
 *    progressing — confirmed from source: a mismatch never reaches the network.
 *  - New Password requires the regex `/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&~...])[...]{6,}$/`
 *    (lower+upper+digit+special, min 6, no spaces — space is blocked at keystroke level too).
 *  - Confirm Password must match New Password, checked live while typing in both directions.
 *
 * A DEEPER finding to verify, not exercised by writing this validation-only test but recorded here so
 * it isn't lost: `changePasswordApi`'s request body sends ONLY `{ oldPassword, confirmPassword }` —
 * the validated `newPassword` value is never included in the payload sent to the server. If accurate,
 * completing this flow could set the password to something other than what the user typed as "new",
 * or the server could reject/ignore the call outright. This needs a dedicated spare account before it
 * can be verified live — flagged, not filed, until that exists.
 */
test.describe(
  'KPost Settings · Change Password panel (validation only, no real submit)',
  { tag: '@ui' },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    test('entering the wrong Old Password is rejected client-side, before any API call @ui', async ({
      page,
      settingsPage,
    }) => {
      await settingsPage.goto();
      await settingsPage.openPanel('General Settings', 'Change Password');

      let requestFired = false;
      page.on('request', (req) => {
        if (req.url().includes('/profile/changePassword')) requestFired = true;
      });

      const oldPasswordField = page.getByPlaceholder(/Enter Your Old Password/i).first();
      await expect(oldPasswordField, 'the Old Password step renders').toBeVisible({
        timeout: 15_000,
      });
      // Deliberately wrong — this must be rejected against Redux state, never reach the API.
      await oldPasswordField.fill('definitely-the-wrong-password-99');
      await page
        .getByRole('button', { name: /^Continue$/i })
        .first()
        .click();

      await expect(
        page.getByText(/Old Password is Incorrect/i).first(),
        'a wrong Old Password is rejected with a clear error',
      ).toBeVisible({ timeout: 10_000 });

      expect(
        requestFired,
        'an incorrect Old Password must be rejected client-side (against Redux state) and never reach ' +
          'the changePassword API',
      ).toBe(false);
    });

    test('the New Password field enforces its complexity rule and Confirm must match, without ever submitting @ui', async ({
      settingsPage,
    }) => {
      await settingsPage.goto();
      await settingsPage.openPanel('General Settings', 'Change Password');

      // We cannot know the account's real current password, so we can't legitimately reach step 2
      // through the normal flow without risking a lockout on a wrong guess being rate-limited. This
      // test therefore stays scoped to what's independently confirmable: the Old Password rejection
      // path (previous test) and the documented regex/matching rules as STATIC facts about the source,
      // recorded here as an explicit note rather than driven live without a safe way to reach step 2.
      test.info().annotations.push({
        type: 'observed',
        description:
          "Step 2 (New/Confirm Password) requires knowing the account's real current password to " +
          'reach via the UI, which this bench does not have for QA_KPOST_ID by design — the regex ' +
          '(lower+upper+digit+special, min 6, no spaces) and match-checking are confirmed from source ' +
          'only, not driven live here. Revisit once a dedicated spare account exists.',
      });
      test.skip(
        true,
        'no safe path to step 2 without a known current password for a spare account',
      );
    });
  },
);
