import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * WHAT is tested: the common module's company lookups and the company logo.
 * HOW is owned by the central validation engine.
 */
test.describe('KPost common · company', () => {
  /*
   * The two logo endpoints are excluded: they are not deployed on either host we have (the workbook
   * points them at a third, `kpostapis.kpostindia.com`). Running them would report 404 on every
   * case - noise about our configuration, not about KPost. See company.api.ts for the evidence.
   */
  describeEndpointCases({ tags: ['common-company'], excludeTags: ['route-not-deployed'] });
});
