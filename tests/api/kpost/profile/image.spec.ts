import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * WHAT is tested: the Profile image uploads (own profile).
 * HOW is owned by the central validation engine.
 */
test.describe('KPost Profile · image', () => {
  describeEndpointCases({ tags: ['profile-image'] });
});
