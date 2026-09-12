import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * WHAT is tested: the common module's reference-data endpoints (countries, states, cities,
 * postcodes, languages, designations). HOW is owned by the central validation engine.
 *
 * Read-only and public: the safest endpoints to run first, and the clearest signal when the
 * environment itself is broken.
 */
test.describe('KPost common · reference data', () => {
  describeEndpointCases({ tags: ['common-reference'] });
});
