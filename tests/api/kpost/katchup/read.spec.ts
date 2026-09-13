import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * WHAT is tested: the Katchup read endpoints — counts, conversations, search, shares, receipts.
 * HOW is owned by the central validation engine.
 *
 * The no-write reads run on the live application (our own account and our own second account as the
 * counterparty); the id-keyed share/reference reads are skipped there until a lifecycle test has
 * created a real message id. All of it runs fully off-live against the mock, where the aggressive
 * probes (injection, null, type, boundary) are safe to send.
 */
test.describe('KPost Katchup · reads', () => {
  describeEndpointCases({ tags: ['katchup-read'] });
});
