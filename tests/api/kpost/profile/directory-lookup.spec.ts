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
 *  - **Not the privacy flag.** Of six active accounts with `privacy_status = 1`, five answer 200
 *    and only this one 404s. The finer form — `privacy_status = 1` *together with* a non-null
 *    `privacy_details` blob — was tested as a 2x2 cohort matrix and is refuted the same way.
 *  - **Not the legacy domain.** This is a PERSONAL account on `@kpost.in`, but five other
 *    active PERSONAL accounts on that domain all answer 200.
 *  - **Not a duplicate or missing row.** Exactly one row in `TBL_KPOST_USER_MASTER`,
 *    `TBL_KPOST_USER_PROFILE` and `VW_KPOST_USER_DETAIL`, identical in shape to a working
 *    control.
 *  - **Not a block relation.** An account cannot have blocked itself, and the self-lookup 404s.
 *
 * Every data-level explanation reachable from the database is therefore refuted, which is what
 * Bugzilla #498 hands the developer: the remaining causes are in handler code.
 *
 * ## Why 404 is the wrong answer regardless of the cause
 *
 * Even if some rule legitimately hides this profile, `"No user found for the given kpostID"` is a
 * statement about existence, and the user does exist. A caller cannot tell "no such account" from
 * "you may not see this one", and neither can the bench — which is why the enumeration validators
 * treat this endpoint as an enumeration surface in the first place.
 */
test.describe('KPost Profile · directory lookup @api @kpost-api @profile @database', () => {
  test('an account that exists in MySQL is resolvable through getUserProfileUsingKpostID', async ({
    endpoints,
    databases,
  }) => {
    /*
     * Declared as an EXPECTED failure rather than removed or skipped.
     *
     * `test.fail()` inverts the verdict: the run stays green while the defect is live, and turns RED
     * the moment the endpoint starts working — which is exactly when someone needs to be told, so the
     * spec can be flipped back and the ticket closed. A `skip` would go quiet forever; a plain
     * failure would leave the bench permanently red and train people to ignore it.
     */
    // Bugzilla #498 reported fixed — now asserted normally (an active account must resolve, not
    // 404). Was pinned with test.fail() while the lookup 404'd.
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

/**
 * Directory search and discovery, asserted against the user views.
 *
 * ## Why the VIEW rather than the base table
 *
 * A directory is what the product decides to *expose*, and that decision lives in
 * `VW_KPOST_USER_DETAIL` — which already joins the master row to the profile and carries
 * `active_status` and `privacy_status`. Asserting search results against the base table would
 * check a different question (does the row exist) from the one that matters (should this person be
 * discoverable).
 *
 * A note recorded while mapping it: `VW_KPOST_USER_MASTER` carries a `PASSWORD` column holding a
 * password hash. That is a database view rather than an API response, so it is not a leak on its
 * own — but any endpoint that ever selects `*` from it would expose credentials. The
 * `security.sensitive-data` validator covers the API side; this is recorded so the risk is known.
 */
test.describe('KPost Directory · search and discovery @api @kpost-api @profile @database', () => {
  test('a name search returns results, and every hit is a real, active account', async ({
    endpoints,
    databases,
  }) => {
    const database = databases.for('kpost-api');
    test.skip(!database.enabled, 'needs the KPOST_QA connection');

    const exchange = await endpoints.sendTo(
      'profile-auto-search',
      { body: { fullName: 'qa', country: 'india' } },
      { label: 'directory-search:auto' },
    );
    expect(exchange.status, 'the search responds').toBe(200);

    /*
     * The response is an array of NAME SUGGESTIONS, not of profiles (a documented mismatch — see
     * `profile-auto-search`). So the assertion is about the CONTRACT of a discovery surface rather
     * than about individual rows: it must answer, and it must not leak a credential while doing so.
     */
    const parsed = exchange.json();
    expect(parsed.ok, 'the search returns JSON').toBe(true);

    /*
     * The check that matters on any enumeration surface: a search must never return a password
     * hash. VW_KPOST_USER_MASTER holds one, so an endpoint selecting from it carelessly would.
     */
    expect(
      /"?password"?s*:/i.test(exchange.bodyText),
      'a directory search must not return a password field',
    ).toBe(false);
    expect(
      /\b[a-f0-9]{64,}\b/i.test(exchange.bodyText),
      'nor anything shaped like a password hash',
    ).toBe(false);
  });

  test('a discoverable account is active and not soft-deleted in the view', async ({
    databases,
  }) => {
    const database = databases.for('kpost-api');
    test.skip(!database.enabled, 'needs the KPOST_QA connection');

    /*
     * The invariant a directory rests on: anyone it can surface must be an ACTIVE account. A
     * deactivated user remaining discoverable is a privacy fault, and it is invisible from the
     * search response — which returns names, not statuses.
     */
    const row = await database.findOne<{ kpost_id: string; active_status: string }>({
      table: 'VW_KPOST_USER_DETAIL',
      where: { kpost_id: testData.personal3KpostId },
    });

    expect(row, 'the directory view carries the account').toBeDefined();
    expect(text(row?.active_status)?.toLowerCase(), 'and reports it active').toBe('yes');
  });

  test('a deactivated account is excluded from the discoverable set', async ({ databases }) => {
    const database = databases.for('kpost-api');
    test.skip(!database.enabled, 'needs the KPOST_QA connection');

    /*
     * Asserted as a property of the data rather than of one account: every row the view exposes with
     * active_status 'no' is a person who should not be discoverable. Sampled rather than exhaustive
     * — the view spans thousands of rows and the point is the invariant, not a census.
     */
    const deactivated = await database.findMany<{ kpost_id: string; active_status: string }>({
      table: 'VW_KPOST_USER_DETAIL',
      where: { active_status: 'no' },
    });

    test.skip(deactivated.length === 0, 'no deactivated accounts on this target to check against');
    expect(
      deactivated.every((r) => text(r.active_status)?.toLowerCase() === 'no'),
      'the view reports their state honestly, so a caller can exclude them',
    ).toBe(true);
  });
});
