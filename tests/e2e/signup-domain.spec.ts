import { SignupPage } from '@pages/SignupPage';
import { domainFor } from '@fixtures/test-accounts';
import { expect, test } from '@fixtures';

/**
 * Personal signup binds the account domain from the account TYPE, not from user input.
 *
 * ## Why this is worth a UI test rather than a contract test
 *
 * The domain is not a field the user fills in — it is a consequence of choosing "Personal", and the
 * screen offers exactly one value for it. That rule exists only in the client: the API accepts
 * whatever `kpostID` it is given, so nothing below the UI enforces it. A regression that added a
 * second option, or pre-selected the business domain, would create personal accounts on
 * `@kpost.in`, and no API or database test would notice until those accounts already existed.
 *
 * It also pins the assumption `src/fixtures/test-accounts.json` is built on. If the product's
 * mapping ever changes, this fails here rather than the bench silently provisioning accounts the
 * product would never have produced.
 *
 * ## Safety
 *
 * **Read-only: the form is never submitted.** `SignupPage` exposes no submit at all, so no account
 * is created and no OTP is requested — which matters on this environment, where the mail server is
 * live.
 */
test.describe('KPost signup · domain is bound by account type', { tag: '@ui' }, () => {
  // Signup is a logged-out journey; the saved session would redirect away from it.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('choosing Personal offers the personal domain, and only that @ui', async ({ page }) => {
    const signup = new SignupPage(page);
    await signup.goto();

    await signup.chooseAccountType('Personal');
    const domains = await signup.domainOptions('India', 'English');

    const expected = `@${domainFor('PERSONAL')}`;

    expect(domains, 'Personal signup offers the personal domain').toContain(expected);
    /*
     * "Only that" is the half that matters. A list that merely *included* the right domain would
     * still let a user create a personal account on the business domain, which is exactly the
     * defect the separation exists to prevent.
     */
    expect(domains, 'and offers no other domain, so the type fully determines it').toEqual([
      expected,
    ]);
    expect(
      domains,
      'the business domain must not be reachable from a Personal signup',
    ).not.toContain(`@${domainFor('BUSINESS_M')}`);
  });
});
