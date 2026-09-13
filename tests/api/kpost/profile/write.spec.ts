import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * WHAT is tested: the Profile writes — about, designation, education, privacy (own profile).
 * HOW is owned by the central validation engine.
 */
test.describe('KPost Profile · write', () => {
  describeEndpointCases({ tags: ['profile-write'] });
});
