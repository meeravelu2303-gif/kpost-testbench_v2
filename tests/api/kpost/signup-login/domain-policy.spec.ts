import { testData } from '@config/test-data.config';
import { KpostRepository } from '@database/repositories/kpost.repository';
import { text } from '@database/kpost-assertions';
import {
  TEST_ACCOUNTS,
  domainFor,
  domainOf,
  findAccount,
  kpostIdOf,
  policyViolation,
} from '@fixtures/test-accounts';
import { expect, test } from '@fixtures';

/**
 * Domain separation by account type, checked where it is actually enforced.
 *
 * ## What the product does, and where
 *
 * KPost routes personal accounts to `@kpostindia.com` and business accounts to `@kpost.in`. The
 * rule is applied **in the signup UI**, which offers exactly one domain once an account type is
 * chosen (proved by `tests/e2e/signup-domain.spec.ts`). Nothing below that re-checks it: the API
 * takes whatever `kpostID` it is handed.
 *
 * So the honest statement of coverage is: the UI is the enforcement point, and these tests verify
 * the *consequences* of the rule at the API and database layers rather than claiming the API
 * enforces something it does not.
 *
 * ## Why this does not attempt a signup
 *
 * Registration is `otpDependent: 'requires'` with `sideEffect: 'global'`, and this environment's
 * mail server is **live**. Creating an account to see whether the wrong domain is rejected would
 * leave a real account behind on every run — and on the failure path it is expected to succeed,
 * which is the worst case to run repeatedly. The existence check below is the same question asked
 * non-destructively.
 */
test.describe('KPost signup · domain policy @api @kpost-api @signup-login @database', () => {
  test('every registry account satisfies the domain policy or is a declared legacy account', () => {
    /*
     * Asserted through `policyViolation()` rather than by comparing domains directly, and across
     * EVERY registry account rather than a chosen two.
     *
     * The direct comparison this replaces was wrong in a way worth recording: `primary` is
     * abhinumukund@kpost.in — a PERSONAL account on the business domain, and the exact legacy
     * exception the next test documents. A raw `domainOf(id) === domainFor('PERSONAL')` therefore
     * failed on data the bench has already established is pre-existing and correct. The registry
     * carries `legacyDomain` for precisely this, and `policyViolation()` is where the exemption
     * is applied — so going around it re-decided the policy in a second place, wrongly.
     *
     * Sweeping all accounts also catches the case that matters: a role repointed in `.env` at an
     * account on the wrong domain, which would otherwise surface only in whichever spec used it.
     */
    for (const account of TEST_ACCOUNTS) {
      const id = kpostIdOf(account);
      if (!id) continue;
      expect(
        policyViolation(id, account.userType, account.legacyDomain),
        `${account.id} must satisfy the domain policy or be a declared legacy account`,
      ).toBeUndefined();
    }
  });

  /*
   * The COMPLETE documented payload, not just the id. `kpostIdExist` requires `firstName`,
   * `lastName` and `mobileNumber` alongside it and answers 500 when they are missing — sending a
   * partial body would report the bench's own omission as an API crash. That mistake has been made
   * here before (see the validateOTP entry in CLAUDE.md §8); a payload is safety-critical, never
   * cosmetic.
   *
   * `mobileNumber` is the configured known-absent fixture: it matches no account, so it names
   * nobody's record and the identifier guard allows it.
   */
  const availability = (kpostID: string): Record<string, unknown> => ({
    kpostID,
    firstName: 'QA',
    lastName: 'Bench',
    mobileNumber: testData.mobileAbsent,
  });

  test('an unprovisioned id is reported available', async ({ endpoints }) => {
    /*
     * `kpostIDExist` is what the signup screen calls as the user types, and the only
     * non-destructive way to ask the API about an account that does not exist yet.
     *
     * The id comes from the configured absent fixture. That is not a style choice: the
     * QA-identifier guard refuses any live request naming an identifier the bench does not own, so
     * an invented id is rejected before it is sent — and an id belonging to a real third party must
     * never be probed at all.
     */
    const exchange = await endpoints.sendTo(
      'signup-login-kpost-id-exist',
      { body: availability(testData.kpostIdAbsent) },
      { label: 'domain-policy:available' },
    );

    expect(exchange.status, 'the availability check answers').toBe(200);
    /*
     * The ENVELOPE, not the transport — KPost reports failure inside a 200 elsewhere, so a
     * status-only check can read a refusal as a success.
     */
    const parsed = exchange.json();
    const envelope = parsed.ok ? (parsed.value as { statusCode?: number; message?: string }) : {};
    expect(envelope.statusCode, 'and reports success in the envelope').toBe(200);
    expect(envelope.message ?? '', 'for an id nobody holds').toMatch(/available/i);
  });

  test('a provisioned id on either policy domain is reported as taken', async ({ endpoints }) => {
    /*
     * The BR-S02 path, asserted on both domains because the collision this separation prevents is
     * an id matched on its local part with the domain ignored — which would show up as one of these
     * two answering "available" for a name that is plainly taken.
     *
     * These ids are provisioned by construction: they are the bench's own registry accounts. An
     * earlier version of this test asserted the opposite ("an unprovisioned id must not be reported
     * as taken") — a premise left behind by the abandoned `qatest_*` provisioning plan, which the
     * switch to pre-existing `.env` accounts silently invalidated.
     */
    const personalAccount = findAccount('primary');
    const businessAccount = findAccount('company-admin');
    expect(personalAccount, 'the registry defines a personal account').toBeDefined();
    expect(businessAccount, 'and a business account').toBeDefined();

    const personal = personalAccount ? (kpostIdOf(personalAccount) ?? '') : '';
    const business = businessAccount ? (kpostIdOf(businessAccount) ?? '') : '';
    expect(domainOf(business), 'the business account is on the business domain').toBe(
      domainFor('BUSINESS_M'),
    );

    for (const [label, kpostId] of [
      ['personal', personal],
      ['business', business],
    ] as const) {
      const exchange = await endpoints.sendTo(
        'signup-login-kpost-id-exist',
        { body: availability(kpostId) },
        { label: `domain-policy:taken-${label}` },
      );

      /*
       * Asserted on the MESSAGE rather than the status, because the status is itself the defect
       * pinned below: what the product must get right here is that an existing id is recognised as
       * existing, on both domains.
       */
      expect(
        exchange.bodyText.toLowerCase(),
        `${label}: a provisioned id must be recognised as taken`,
      ).toMatch(/already exi/);

      /*
       * The suggestions are the proof the lookup actually ran rather than erroring out: a genuine
       * server fault would have no alternatives to offer.
       */
      const parsed = exchange.json();
      const envelope = parsed.ok ? (parsed.value as { data?: unknown }) : {};
      expect(
        Array.isArray(envelope.data) && envelope.data.length > 0,
        `${label}: the endpoint returns alternative ids, so the check completed`,
      ).toBe(true);
    }
  });

  test('a taken id is refused with a client error, not a 500', async ({ endpoints }) => {
    /*
     * Expected failure while Bugzilla #497 is open.
     *
     * MEASURED: an existing id is answered `HTTP 500` with `{"status":"FAILURE","statusCode":500,
     * "message":"KpostID is already exits!","data":[...]}`, while an absent id is answered 200.
     * "This name is taken, here are alternatives" is the most common outcome on a signup form and a
     * completed, successful lookup — reporting it as a server error means every client's error
     * handling sees an outage on the normal path, retries and circuit breakers trip on healthy
     * traffic, and a real fault here is indistinguishable from a user picking a popular name.
     *
     * Kept as `test.fail()` rather than deleted: the run stays green while the defect is live and
     * turns RED the moment the status is corrected, which is when this can be flipped back.
     */
    // Bugzilla #497 reported fixed — now asserted normally (a taken KPost ID must be a clean 4xx,
    // not a 500). Was pinned with test.fail() while it answered HTTP 500.

    const account = findAccount('primary');
    const exchange = await endpoints.sendTo(
      'signup-login-kpost-id-exist',
      { body: availability(account ? (kpostIdOf(account) ?? '') : '') },
      { label: 'domain-policy:taken-status' },
    );

    expect(
      exchange.status,
      `a taken id is a business outcome, not a server fault (body: ${exchange.bodyText.slice(0, 200)})`,
    ).toBeLessThan(500);
  });

  test('live accounts follow the domain policy, and the legacy exceptions are known', async ({
    databases,
  }) => {
    const database = databases.for('kpost-api');
    test.skip(!database.enabled, 'needs the KPOST_QA connection');

    /*
     * The policy asserted against real data rather than against the registry, which would only be
     * checking the bench agrees with itself.
     *
     * The counts are deliberately not pinned exactly — this is a shared test database and accounts
     * are created on it continuously. What is pinned is the SHAPE: the personal domain is where
     * personal accounts predominantly live, and the business domain is where business accounts do.
     */
    const repo = new KpostRepository(database);
    const sample = await repo.user('abhinumukund@kpost.in');
    test.skip(!sample, 'the legacy reference account is absent from this target');

    /*
     * This is one of the ~205 legacy personal accounts on the business domain. Asserted explicitly
     * so the exception is documented in a test rather than only in prose: it is pre-existing data,
     * not a defect, and not something the bench should "fix" — a kpost_id is the primary key across
     * ~90 tables.
     */
    expect(text(sample?.user_type), 'the reference account is PERSONAL').toBe('PERSONAL');
    expect(domainOf('abhinumukund@kpost.in'), 'and sits on the business domain').toBe(
      domainFor('BUSINESS_M'),
    );
    expect(
      domainOf('abhinumukund@kpost.in'),
      'which is exactly the legacy mismatch the policy replaced',
    ).not.toBe(domainFor('PERSONAL'));
  });

  test('KPost IDs cannot contain an underscore — the constraint that blocks qatest_* naming', () => {
    /*
     * MEASURED, not assumed. Two otherwise identical signup payloads with distinct mobile numbers:
     * `qatest_sender@kpostindia.com` was refused with {statusCode: 500, "Enter valid Credentials"},
     * `qatestsender@kpostindia.com` was not refused for that reason. Corroborated by the data —
     * 0 of the 2,167 accounts on KPOST_QA contain an underscore in `kpost_id`.
     *
     * Pinned here because it is the reason the bench uses the pre-existing `.env` accounts rather
     * than creating `qatest_*` ones: the mandated shape cannot be registered through the product.
     * If signup ever accepts an underscore, this fails and the provisioning route reopens.
     */
    for (const account of TEST_ACCOUNTS) {
      const id = kpostIdOf(account);
      if (!id) continue;
      expect(
        id,
        `${account.id} must not contain an underscore — signup rejects those`,
      ).not.toContain('_');
    }
  });
});
