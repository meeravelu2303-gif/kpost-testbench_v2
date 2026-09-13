import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * WHAT is tested: the Profile reads — fetch, search, digital card, downloads (live-safe).
 * HOW is owned by the central validation engine.
 */
test.describe('KPost Profile · read', () => {
  describeEndpointCases({ tags: ['profile-read'] });
});
