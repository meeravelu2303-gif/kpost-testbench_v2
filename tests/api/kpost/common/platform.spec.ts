import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * WHAT is tested: service status, the mobile app version gate, and the public write endpoints
 * (enquiry, unsubscribe, usage totals). HOW is owned by the central validation engine.
 */
test.describe('KPost common · platform', () => {
  describeEndpointCases({ tags: ['common-platform'] });
});
