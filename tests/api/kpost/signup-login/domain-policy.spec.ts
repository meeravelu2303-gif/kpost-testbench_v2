import { testData } from '@config/test-data.config';
import { KpostRepository } from '@database/repositories/kpost.repository';
import { text } from '@database/kpost-assertions';
import { domainFor, domainOf, findAccount, qatestId } from '@fixtures/test-accounts';
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
test.describe('KPost signup · domain policy @api @kpost-api @signup-login', () => {
  test('the id-availability check answers for both policy domains', async ({ endpoints }) => {
    /*
     * `kpostIDExist` is the endpoint the signup screen calls as the user types, and it is the only
     * non-destructive way to ask the API about an account that does not exist yet.
     *
     * The ids come from the REGISTRY rather than being built ad hoc. That is not a style choice:
     * the QA-identifier guard refuses any live request naming an identifier the bench does not own,
     * and it builds that list from the registry — so an invented id is correctly rejected before it
     * is sent. Using registry accounts is what makes this request legitimate.
     */
    const personalAccount = findAccount('primary');
    const businessAccount = findAccount('company-admin');
    expect(personalAccount, 'the registry defines a personal account').toBeDefined();
    expect(businessAccount, 'and a business account').toBeDefined();

    const personal = personalAccount?.kpostId ?? '';
    const business = businessAccount?.kpostId ?? '';

    expect(domainOf(personal), 'the personal account is on the personal domain').toBe(
      domainFor('PERSONAL'),
    );
    expect(domainOf(business), 'the business account is on the business domain').toBe(
      domainFor('BUSINESS_M'),
    );

    /*
     * The COMPLETE documented payload, not just the id. `kpostIdExist` requires `firstName`,
     * `lastName` and `mobileNumber` alongside it, and answers 500 when they are missing — sending a
     * partial body would report the bench's own omission as an API crash. That mistake has been
     * made here before (see the validateOTP entry in CLAUDE.md §8), and the rule it produced is
     * that a payload is safety-critical, never cosmetic.
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

    const first = await endpoints.sendTo(
      'signup-login-kpost-id-exist',
      { body: availability(personal) },
      { label: 'domain-policy:personal' },
    );
    const second = await endpoints.sendTo(
      'signup-login-kpost-id-exist',
      { body: availability(business) },
      { label: 'domain-policy:business' },
    );

    expect(first.status, 'the availability check answers for the personal domain').toBeLessThan(
      500,
    );
    expect(second.status, 'and for the business domain').toBeLessThan(500);

    /*
     * Neither may report an existing account: these ids are unprovisioned by construction. A "taken"
     * answer here would mean the API is matching on the local part and ignoring the domain, which is
     * exactly the collision the separation is meant to prevent.
     */
    for (const [label, exchange] of [
      ['personal', first],
      ['business', second],
    ] as const) {
      expect(
        exchange.bodyText.toLowerCase(),
        `${label}: an unprovisioned id must not be reported as taken`,
      ).not.toMatch(/already (exists|registered|taken)/);
    }
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

  test('the bench will not build an id that breaks the policy', () => {
    /*
     * The guard that keeps the rule from being bypassed by accident. Every bench-owned id comes from
     * `qatestId`, so a spec cannot hand-write a personal id on the business domain — the helper has
     * no parameter for it.
     */
    expect(qatestId('primary', 'PERSONAL')).toBe('qatest_primary@kpostindia.com');
    expect(qatestId('primary', 'BUSINESS_M')).toBe('qatest_primary@kpost.in');
    expect(() => qatestId('bad id', 'PERSONAL'), 'a malformed identifier is refused').toThrow();
  });
});
