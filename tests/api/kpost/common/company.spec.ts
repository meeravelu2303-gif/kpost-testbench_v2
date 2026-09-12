import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * WHAT is tested: the common module's company lookups and the company logo.
 * HOW is owned by the central validation engine.
 */
test.describe('KPost common · company', () => {
  /*
   * `needs-login` is excluded: downloadCompanyLogo requires a token, which does not exist until
   * the Signup & Login module is built. Its definition stays registered (and the coverage
   * self-test still counts it) so nobody has to remember to add it back.
   */
  describeEndpointCases({ tags: ['common-company'], excludeTags: ['needs-login'] });
});
