import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * WHAT is tested: the common module's existence checks and identity lookups.
 * HOW is owned by the central validation engine.
 *
 * Every endpoint here answers a question about somebody else's data without a token, so the
 * security validators (information disclosure, sensitive data, injection) carry the weight.
 */
test.describe('KPost common · identity lookups', () => {
  describeEndpointCases({ tags: ['common-identity'] });
});
