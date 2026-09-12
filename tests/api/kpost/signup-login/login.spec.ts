import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * WHAT is tested: login, token refresh, sessions and logout.
 * HOW is owned by the central validation engine — see src/validators/.
 *
 * The login endpoint is also what issues every other module's token, so a failure here is the
 * first thing to read in a broken run.
 */
test.describe('KPost Signup & Login · login and sessions', () => {
  describeEndpointCases({ tags: ['login'] });
});
