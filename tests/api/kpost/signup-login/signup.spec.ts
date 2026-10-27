import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * WHAT is tested: the signup-screen endpoints. HOW is owned by the central validation engine.
 * The two registration endpoints are `@destructive` and excluded by the config's `grepInvert`.
 */
test.describe(
  'KPost Signup · contract validation',
  { tag: ['@api', '@auth', '@regression'] },
  () => {
    describeEndpointCases({ tags: ['signup'] });
  },
);
