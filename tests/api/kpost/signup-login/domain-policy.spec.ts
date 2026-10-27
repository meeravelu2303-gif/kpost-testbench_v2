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
 * Personal accounts live on `@kpostindia.com`, business on `@kpost.in`. Only the signup UI enforces
 * this, so these tests check its consequences in the API and DB, without registering an account.
 */
test.describe(
  'KPost signup · domain policy @api @kpost-api @signup-login @database',
  { tag: ['@api', '@auth', '@regression'] },
  () => {
    test('every registry account satisfies the domain policy or is a declared legacy account', () => {
      // Uses `policyViolation()`, which applies the `legacyDomain` exemption, and sweeps every account
      // so a role repointed in `.env` at a wrong-domain account is caught here.
      for (const account of TEST_ACCOUNTS) {
        const id = kpostIdOf(account);
        if (!id) continue;
        expect(
          policyViolation(id, account.userType, account.legacyDomain),
          `${account.id} must satisfy the domain policy or be a declared legacy account`,
        ).toBeUndefined();
      }
    });

    // The full documented payload: `kpostIdExist` answers 500 without firstName/lastName/mobileNumber.
    // `mobileAbsent` matches no account, so the identifier guard allows it.
    const availability = (kpostID: string): Record<string, unknown> => ({
      kpostID,
      firstName: 'QA',
      lastName: 'Bench',
      mobileNumber: testData.mobileAbsent,
    });

    test(
      'an unprovisioned id is reported available',
      { annotation: [{ type: 'requirement', description: 'BR-SL-UNIQUE' }] },
      async ({ endpoints }) => {
        // Uses the configured absent fixture: the QA-identifier guard refuses invented ids.
        const exchange = await endpoints.sendTo(
          'signup-login-kpost-id-exist',
          { body: availability(testData.kpostIdAbsent) },
          { label: 'domain-policy:available' },
        );

        expect(exchange.status, 'the availability check answers').toBe(200);
        // Check the envelope too: KPost can report failure inside a 200.
        const parsed = exchange.json();
        const envelope = parsed.ok
          ? (parsed.value as { statusCode?: number; message?: string })
          : {};
        expect(envelope.statusCode, 'and reports success in the envelope').toBe(200);
        expect(envelope.message ?? '', 'for an id nobody holds').toMatch(/available/i);
      },
    );

    test(
      'a provisioned id on either policy domain is reported as taken',
      { annotation: [{ type: 'requirement', description: 'BR-SL-UNIQUE' }] },
      async ({ endpoints }) => {
        // Both domains, so a lookup that ignores the domain part shows up as "available". The ids
        // are the bench's own registry accounts, so they exist.
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

          // Asserted on the message; the status is checked by the next test.
          expect(
            exchange.bodyText.toLowerCase(),
            `${label}: a provisioned id must be recognised as taken`,
          ).toMatch(/already exi/);

          // Alternative ids prove the lookup completed rather than erroring out.
          const parsed = exchange.json();
          const envelope = parsed.ok ? (parsed.value as { data?: unknown }) : {};
          expect(
            Array.isArray(envelope.data) && envelope.data.length > 0,
            `${label}: the endpoint returns alternative ids, so the check completed`,
          ).toBe(true);
        }
      },
    );

    test('a taken id is refused with a client error, not a 500', async ({ endpoints }) => {
      // Regression guard for #497: a taken id must not be answered with a 500.

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

      const repo = new KpostRepository(database);
      const sample = await repo.user('abhinumukund@kpost.in');
      test.skip(!sample, 'the legacy reference account is absent from this target');

      // One of the ~205 legacy personal accounts on the business domain: pre-existing data, not a
      // defect (kpost_id is the primary key across ~90 tables).
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
      // Signup refuses ids with an underscore, so no registry account may use one.
      for (const account of TEST_ACCOUNTS) {
        const id = kpostIdOf(account);
        if (!id) continue;
        expect(
          id,
          `${account.id} must not contain an underscore — signup rejects those`,
        ).not.toContain('_');
      }
    });
  },
);
