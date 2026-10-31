import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * WHAT is tested: login, token refresh, sessions and logout. HOW is owned by the validation engine.
 * Login issues every other module's token, so read a failure here first in a broken run.
 */
test.describe(
  'KPost Login · contract validation',
  { tag: ['@api', '@auth', '@regression'] },
  () => {
    // `userLogout` would end the shared cached session; login-flow.spec.ts tests it on its own session.
    describeEndpointCases({ tags: ['login'], excludeTags: ['session-ending'] });
  },
);
