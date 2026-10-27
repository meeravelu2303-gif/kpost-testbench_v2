import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * The Kall reads (call log, today's calls, frequent contacts, contact info), through the validation
 * engine. The two `kallID`-keyed status reads skip on live (`needs-kall-id`).
 */
test.describe('KPost Kall · reads', { tag: ['@api', '@kall', '@regression'] }, () => {
  describeEndpointCases({ tags: ['kall-read'] });
});
