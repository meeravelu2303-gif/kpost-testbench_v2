import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * WHAT is tested: the Katchup attachment download, thumbnail, streaming.
 * HOW is owned by the central validation engine.
 *
 * These act on a real message id / attachment uuid the caller owns, which the live application does
 * not have until a lifecycle test creates one — so they are skipped there with the reason, and run
 * in full off-live against the mock.
 */
test.describe('KPost Katchup · attachments', () => {
  describeEndpointCases({ tags: ['katchup-attachment'] });
});
