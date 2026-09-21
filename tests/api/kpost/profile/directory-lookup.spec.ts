import { testData } from '@config/test-data.config';
import { KpostRepository } from '@database/repositories/kpost.repository';
import { text } from '@database/kpost-assertions';
import { expect, test } from '@fixtures';

/**
 * `getUserProfileUsingKpostID` answers 404 for an account that exists.
 *
 * ## Why this file exists
 *
 * The endpoint's contract probes were pointed at a second account so they could exercise its real
 * success path (see `profile-user-profile-by-kpostid`). That change makes the suite useful again,
 * and it would also make this defect disappear — so the defect gets its own test, which fails on
 * purpose until the API is fixed.
 *
 * ## The finding, and what was ruled out
 *
 * `testData.kpostId` is answered `404 "No user found for the given kpostID"`, while the same
 * account logs in (200), is served by `fetchUserDetails` (200), and — proven below against MySQL —
 * is active in `TBL_KPOST_USER_MASTER` with exactly one `TBL_KPOST_USER_PROFILE` row.
 *
 * Two plausible explanations were tested and **refuted**, which is what makes this a defect rather
 * than a rule nobody documented:
 *
 *  - **Not a self-lookup restriction.** A second account looking *itself* up is answered 200, and a
 *    third caller asking for THIS account is still answered 404. The 404 follows the subject, not
 *    the caller.
 *  - **Not the privacy flag.** Three of four sampled accounts with `privacy_status = 1` answer 200.
 *
 * ## Why 404 is the wrong answer regardless of the cause
 *
 * Even if some rule legitimately hides this profile, `"No user found for the given kpostID"` is a
 * statement about existence, and the user does exist. A caller cannot tell "no such account" from
 * "you may not see this one", and neither can the bench — which is why the enumeration validators
 * treat this endpoint as an enumeration surface in the first place.
 */
test.describe('KPost Profile · directory lookup @api @kpost-api @profile', () => {
  test('an account that exists in MySQL is resolvable through getUserProfileUsingKpostID', async ({
    endpoints,
    databases,
  }) => {
    /*
     * The database half runs first and is asserted separately, so a failure names the right layer:
     * if the row were genuinely missing this would be a data problem, not an API defect, and the
     * ticket would go to the wrong person.
     */
    const database = databases.for('kpost-api');
    test.skip(
      !database.enabled,
      'needs the KPOST_QA connection (DB_HOST/DB_NAME) to prove the account exists',
    );

    const repo = new KpostRepository(database);
    const account = await repo.user(testData.kpostId);
    const profile = await repo.profile(testData.kpostId);

    expect(account, `${testData.kpostId} must exist in TBL_KPOST_USER_MASTER`).toBeDefined();
    expect(text(account?.active_status)?.toLowerCase(), 'and be active').toBe('yes');
    expect(profile, 'and have a TBL_KPOST_USER_PROFILE row').toBeDefined();

    // With existence established in the database, the API must not deny it.
    const exchange = await endpoints.sendTo(
      'profile-user-profile-by-kpostid',
      { body: { kpostID: testData.kpostId } },
      { label: 'directory-lookup:self' },
    );

    expect(
      exchange.status,
      `the account is active in TBL_KPOST_USER_MASTER with a profile row, so "no user found" is ` +
        `contradicted by the database (body: ${exchange.bodyText.slice(0, 200)})`,
    ).not.toBe(404);
  });

  test('the second personal account resolves, so the endpoint itself works', async ({
    endpoints,
  }) => {
    /*
     * The control. Without it, a 404 above could equally mean the endpoint is broken for everyone,
     * the path is wrong, or the token is bad — and the finding would not be actionable. This proves
     * the endpoint, the path and the credentials are all fine, which is what narrows the defect
     * down to the subject account.
     */
    const exchange = await endpoints.sendTo(
      'profile-user-profile-by-kpostid',
      { body: { kpostID: testData.personal3KpostId } },
      { label: 'directory-lookup:control' },
    );

    expect(exchange.status, 'the control account resolves').toBe(200);
  });

  test('a genuinely absent account is refused the same way, without leaking which is which', async ({
    endpoints,
  }) => {
    /*
     * The enumeration question this endpoint's tags already claim to care about: an account that
     * does not exist and one that is merely hidden must be indistinguishable. Today they are — both
     * 404 — which is the *right* privacy answer and the reason the defect above is ambiguous rather
     * than obviously a leak. Pinned so that a future fix does not accidentally split them apart.
     */
    const absent = await endpoints.sendTo(
      'profile-user-profile-by-kpostid',
      { body: { kpostID: testData.kpostIdAbsent } },
      { label: 'directory-lookup:absent' },
    );

    expect(absent.status, 'an unknown id is refused').toBe(404);
  });
});
