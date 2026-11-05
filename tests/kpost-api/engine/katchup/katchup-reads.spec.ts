import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * The Katchup reads (counts, conversations, search, shares, receipts), through the validation engine.
 * Id-keyed reads skip on live without a real message id; everything runs in full against the mock.
 */
test.describe('KPost Katchup · reads', { tag: ['@api', '@katchup', '@regression'] }, () => {
  describeEndpointCases({ tags: ['katchup-read'] });
});
