import { SignupPage } from '@pages/SignupPage';
import { domainFor } from '@fixtures/test-accounts';
import { expect, test } from '@fixtures';

/**
 * Personal signup offers exactly one domain, bound by the account type. Only the client enforces this
 * rule. Read-only: the form is never submitted.
 */
test.describe(
  'KPost signup · domain is bound by account type',
  { tag: ['@ui', '@auth', '@signup', '@regression'] },
  () => {
    // Signup is a logged-out journey; the saved session would redirect away from it.
    test.use({ storageState: { cookies: [], origins: [] } });

    test('choosing Personal offers the personal domain, and only that @ui', async ({ page }) => {
      const signup = new SignupPage(page);
      await signup.goto();

      await signup.chooseAccountType('Personal');
      const domains = await signup.domainOptions('India', 'English');

      const expected = `@${domainFor('PERSONAL')}`;

      expect(domains, 'Personal signup offers the personal domain').toContain(expected);
      // "Only that" matters: any extra option would allow a personal account on the business domain.
      expect(domains, 'and offers no other domain, so the type fully determines it').toEqual([
        expected,
      ]);
      expect(
        domains,
        'the business domain must not be reachable from a Personal signup',
      ).not.toContain(`@${domainFor('BUSINESS_M')}`);
    });
  },
);
