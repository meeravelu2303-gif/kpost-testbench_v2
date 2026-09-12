import { describeEndpointContracts } from '@engine/contract-suite';
import { test } from '@fixtures';

// Admin module (separate repo). Defects file to the KPost Admin product — owner: Jaganathan Murthy.
// Skips until ADMIN_API_BASE_URL is configured.
test.describe('Admin API', () => {
  describeEndpointContracts({ suites: ['admin-api'] }, { allowEmpty: true });
});
