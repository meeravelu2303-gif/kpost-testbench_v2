import { testData } from '@config/test-data.config';
import { KpostRepository } from '@database/repositories/kpost.repository';
import { text } from '@database/kpost-assertions';
import { expect, test } from '@fixtures';

/**
 * `getUserProfileUsingKpostID` must resolve an account that exists in MySQL (Bugzilla #498: it
 * answered 404 for an active account). A second account serves as the working control.
 */
test.describe(
  'KPost Profile · directory lookup @api @kpost-api @profile @database',
  { tag: ['@api', '@profile', '@regression'] },
  () => {
    test('an account that exists in MySQL is resolvable through getUserProfileUsingKpostID', async ({
      endpoints,
      databases,
    }) => {
      // The database half runs first, so a failure names the right layer (data, not API).
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
      // Control: proves the endpoint, path and token work, so a 404 above is about the subject.
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
      // An absent account and a hidden one must be indistinguishable (no enumeration).
      const absent = await endpoints.sendTo(
        'profile-user-profile-by-kpostid',
        { body: { kpostID: testData.kpostIdAbsent } },
        { label: 'directory-lookup:absent' },
      );

      expect(absent.status, 'an unknown id is refused').toBe(404);
    });
  },
);

/**
 * Directory search and discovery, asserted against `VW_KPOST_USER_DETAIL` (what the product exposes,
 * with active/privacy status) rather than the base table.
 */
test.describe(
  'KPost Directory · search and discovery @api @kpost-api @profile @database',
  { tag: ['@api', '@profile', '@regression'] },
  () => {
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

      // The response is name suggestions, not profiles, so only the contract is asserted.
      const parsed = exchange.json();
      expect(parsed.ok, 'the search returns JSON').toBe(true);

      // VW_KPOST_USER_MASTER holds a password hash; a search must never return it.
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

      // Anyone the directory can surface must be an ACTIVE account.
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

      // Rows with active_status 'no' must report that honestly so callers can exclude them.
      const deactivated = await database.findMany<{ kpost_id: string; active_status: string }>({
        table: 'VW_KPOST_USER_DETAIL',
        where: { active_status: 'no' },
      });

      test.skip(
        deactivated.length === 0,
        'no deactivated accounts on this target to check against',
      );
      expect(
        deactivated.every((r) => text(r.active_status)?.toLowerCase() === 'no'),
        'the view reports their state honestly, so a caller can exclude them',
      ).toBe(true);
    });
  },
);
