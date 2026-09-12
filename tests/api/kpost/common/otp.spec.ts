import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * WHAT is tested: the common module's OTP and password-recovery endpoints.
 * HOW is owned by the central validation engine — see src/validators/.
 *
 * These endpoints send real SMS and email, so they are marked destructive and a default run
 * reports them as skipped unless ALLOW_DESTRUCTIVE_TESTS=true.
 */
test.describe('KPost common · OTP and password recovery', () => {
  describeEndpointCases({ tags: ['common-otp'] });
});
