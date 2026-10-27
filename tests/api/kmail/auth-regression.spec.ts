import { testData } from '@config/test-data.config';
import { KpostRepository } from '@database/repositories/kpost.repository';
import { expect, test } from '@fixtures';

/**
 * Does KMail accept a valid KPost token? Runs even while the other KMail specs are gated behind
 * KMAIL_AUTH_FIXED, so a refused token files as one engine-reported bug, not hundreds of follow-ons.
 * It uses the engine because the Bugzilla reporter files from validation reports, not plain expects.
 */
test.describe(
  'KMail · authentication regression @api @kmail-api @kmail @database',
  { tag: ['@api', '@kmail', '@regression'] },
  () => {
    test('a valid KPost token is accepted by KPost and refused by KMail', async ({
      validationEngine,
      endpoints,
      databases,
    }) => {
      // SMOKE: the narrowest profile that still runs authentication.valid-token, without negative
      // probes that would all fail for the same reason.
      const report = await validationEngine.validate('kmail-saluations', { profile: 'SMOKE' });

      const auth = report.results.find((r) => r.validatorName === 'authentication.valid-token');
      expect(auth, 'the valid-token check is planned for this endpoint').toBeDefined();
      // It must actually run: `.not.toBe('FAILED')` below would pass on SKIPPED.
      expect(
        auth?.status,
        `the valid-token check must run, not skip (reason: ${auth?.message ?? 'none given'})`,
      ).not.toBe('SKIPPED');

      // Control: the same credentials answer 200 on KPost, so the token is not stale.
      const control = await endpoints.sendTo(
        'profile-fetch-user-details',
        {},
        { label: 'kmail-auth-regression:kpost-control' },
      );
      expect(control.status, 'the same credentials are accepted by KPost').toBe(200);

      // A kmail_password in the DB shows the account is provisioned for KMail.
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
  },
);
