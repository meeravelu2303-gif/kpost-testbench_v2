import { describeEndpointContracts } from '@engine/contract-suite';
import { test } from '@fixtures';

// WHAT is tested: every endpoint tagged "users". HOW is owned by the central validation engine.
test.describe('Users API', () => {
  describeEndpointContracts({ tags: ['users'] });
});
