import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * WHAT is tested: the common module's company lookups and the company logo.
 * HOW is owned by the central validation engine.
 */
test.describe('KPost common · company', () => {
  /*
   * Nothing is excluded any more. downloadCompanyLogo needs a token, and Signup & Login now issues
   * one, so the whole group runs - including the auth probes that only that endpoint can exercise.
   */
  describeEndpointCases({ tags: ['common-company'] });
});
