import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * WHAT is tested: the common module's company lookups and the company logo.
 * HOW is owned by the central validation engine.
 */
test.describe('KPost common · company', () => {
  /*
   * Nothing is excluded. The logo routes were corrected from the API owner's working calls, so they
   * reach real handlers now — and what they report is a genuine finding rather than configuration
   * noise: `downloadCompanyLogo` answers 500 to every request, including an unauthenticated one.
   * See company.api.ts for the corrections and the evidence behind them.
   */
  describeEndpointCases({ tags: ['common-company'] });
});
