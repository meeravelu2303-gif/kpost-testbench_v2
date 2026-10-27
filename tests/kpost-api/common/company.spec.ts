import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * WHAT is tested: the common module's company lookups and the company logo.
 * HOW is owned by the central validation engine.
 */
test.describe('KPost common · company', { tag: ['@api', '@platform', '@regression'] }, () => {
  // Nothing excluded. Known defect: downloadCompanyLogo answers 500 to every request.
  describeEndpointCases({ tags: ['common-company'] });
});
