import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * WHAT is tested: the Profile device designation, password and deactivation (OTP-gated).
 * HOW is owned by the central validation engine.
 */
test.describe('KPost Profile · device', () => {
  describeEndpointCases({ tags: ['profile-device'] });
});
