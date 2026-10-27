import { describeEndpointContracts } from '@engine/contract-suite';
import { test } from '@fixtures';

// The engine over every Admin API endpoint. Skips until ADMIN_API_BASE_URL is configured.
// Role posting writes are excluded: they create real KPost/KSMACC accounts, which fuzzing must not
// touch (role-posting-lifecycle.spec.ts covers them).
test.describe('Admin API', () => {
  describeEndpointContracts(
    { suites: ['admin-api'], excludeTags: ['role-posting-mutation'] },
    { allowEmpty: true },
  );
});
