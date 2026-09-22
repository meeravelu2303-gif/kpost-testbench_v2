import { testData } from '@config/test-data.config';
import { KpostRepository } from '@database/repositories/kpost.repository';
import { expect, test } from '@fixtures';

/**
 * KMail rejects every valid KPost token — the one KMail spec that still runs.
 *
 * ## Why this exists while the rest of the module is gated
 *
 * Every other KMail spec is switched off behind `KMAIL_AUTH_FIXED` (see `kmailAuthGate`), because
 * with the host refusing all authentication they produce hundreds of *downstream* failures — a
 * content-type failure on a 401 body, a security-header failure on an error page, every negative
 * probe "failing" because it got 401 instead of 400. None of that is a defect in its own right, and
 * filing it would bury the one fault that is.
 *
 * This spec is the exception: it drives the **engine** at a single KMail endpoint so the run
 * produces one validation report, `authentication.valid-token` fails on it, and the Bugzilla
 * pipeline gets exactly one well-evidenced candidate instead of hundreds of consequences.
 *
 * ## Why the engine rather than a hand-written assertion
 *
 * The Bugzilla reporter builds candidates from **validation reports**, not from plain Playwright
 * failures — a bespoke `expect()` produces nothing for it to file. Running the engine is what turns
 * this into a ticket, and it is also what routes the failure through the 3-pass reproduction gate
 * so a transient 401 could not file on its own.
 *
 * ## What was ruled out before calling it a product defect
 *
 * | Control | Result |
 * | --- | --- |
 * | Same token → KPost `fetchUserDetails` | 200 |
 * | Same token → KMail `getSaluations` | 401 |
 * | 4 accounts, separate tokens | 401 every time |
 * | `module` 0 / 1 / 2 on login | 401 every time |
 * | No `Authorization` header | Spring's *generic* 401 |
 * | `Bearer <token>` | KMail's **own** `UNAUTHORIZED USER` |
 *
 * The last pair is decisive: the two 401s come from different layers, so the scheme is right and the
 * application is refusing the authenticated principal. `docs/LIVE-ENDPOINTS.md` — generated from
 * earlier runs of this bench — records these same endpoints as working, so this is a regression on
 * the host rather than a change here.
 */
test.describe('KMail · authentication regression @api @kmail-api @kmail @database', () => {
  test('a valid KPost token is accepted by KPost and refused by KMail', async ({
    validationEngine,
    endpoints,
    databases,
  }) => {
    /*
     * SMOKE deliberately: the narrowest validator set that still includes
     * `authentication.valid-token`. A deeper profile would add the negative probes, and every one of
     * them would "fail" for the same single reason — which is exactly the noise this spec exists to
     * avoid producing.
     */
    const report = await validationEngine.validate('kmail-saluations', { profile: 'SMOKE' });

    const auth = report.results.find((r) => r.validatorName === 'authentication.valid-token');
    expect(auth, 'the valid-token check is planned for this endpoint').toBeDefined();
    /*
     * It must actually have RUN. A SKIPPED result is not evidence of anything, and an earlier
     * version of this spec passed on exactly that: `.not.toBe('FAILED')` is satisfied by SKIPPED,
     * so the test went green while the endpoint was never called. Requiring a real verdict is what
     * makes the assertion below mean something.
     */
    expect(
      auth?.status,
      `the valid-token check must run, not skip (reason: ${auth?.message ?? 'none given'})`,
    ).not.toBe('SKIPPED');

    /*
     * The control, in the same test so the ticket carries it: the SAME credentials answer 200 on
     * KPost. Without this a reader cannot tell "KMail is broken" from "our token is stale", and the
     * developer's first question would be exactly that.
     */
    const control = await endpoints.sendTo(
      'profile-fetch-user-details',
      {},
      { label: 'kmail-auth-regression:kpost-control' },
    );
    expect(control.status, 'the same credentials are accepted by KPost').toBe(200);

    /*
     * And the database half: the account is provisioned for KMail. `kmail_password` being present
     * rules out "this account was never set up for mail", which is the other thing a developer
     * would reasonably suspect first.
     */
    const database = databases.for('kpost-api');
    if (database.enabled) {
      const user = await new KpostRepository(database).user(testData.kpostId);
      expect(user, 'the account exists in TBL_KPOST_USER_MASTER').toBeDefined();
      expect(
        user?.kmail_password,
        'and carries a kmail_password, so it IS provisioned for KMail',
      ).toBeTruthy();
    }

    // The assertion that fails while the defect is live, and passes the moment it is fixed.
    expect(
      auth?.status,
      `KMail refused a token KPost accepts (control: ${control.status}). ` +
        `${auth?.message ?? ''}`,
    ).not.toBe('FAILED');
  });
});
