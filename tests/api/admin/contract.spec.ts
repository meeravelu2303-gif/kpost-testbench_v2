import { describeEndpointContracts } from '@engine/contract-suite';
import { test } from '@fixtures';

// Admin module (separate repo). Defects file to the KPost Admin product — owner: Jaganathan Murthy.
// Skips until ADMIN_API_BASE_URL is configured.
//
// `role-posting-mutation` (save/update/delete/suspend-terminate) is excluded even with
// ALLOW_DESTRUCTIVE_TESTS: confirmed against the Admin_Module backend source
// (RolePostingSetUpServiceImpl) that these make real, hardcoded outbound calls to
// login.ksmacc.in / apigateway.ksmacc.in / devapi2.kpostindia.com. Fuzzing them with boundary/
// malformed ids risks acting on a real external account, not just corrupting our own data — a
// different class of risk than the rest of the module's writes (pure MongoDB operations).
test.describe('Admin API', () => {
  describeEndpointContracts(
    { suites: ['admin-api'], excludeTags: ['role-posting-mutation'] },
    { allowEmpty: true },
  );
});
