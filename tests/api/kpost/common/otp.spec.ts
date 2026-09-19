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
  // Exclude the OTP-CONSUME endpoints (validateOTP / validateMailOTP): validating a code needs a live
  // session from a PRIOR send in the SAME run, which the standalone engine does not do — so run
  // standalone they always answer 500 ("OTP validation failed"), a bench precondition, not a defect.
  // They are exercised end-to-end (send → validate) by the OTP signup lifecycle instead.
  describeEndpointCases({ tags: ['common-otp'], excludeTags: ['otp-consume'] });
});
