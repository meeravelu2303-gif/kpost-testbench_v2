import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * WHAT is tested: the Kall reads — the call log, today's scheduled calls, frequent contacts, and
 * contact info. HOW is owned by the central validation engine. The log/contact reads run on live
 * (our own account); the two `kallID`-keyed status reads are blocked (`needs-kall-id`) and skip
 * with that reason on a live pass.
 */
test.describe('KPost Kall · reads', () => {
  describeEndpointCases({ tags: ['kall-read'] });
});
