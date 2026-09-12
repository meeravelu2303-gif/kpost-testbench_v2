import { describeEndpointContracts } from '@engine/contract-suite';
import { test } from '@fixtures';

test.describe('Auth API', () => {
  describeEndpointContracts({ tags: ['auth'] });
});
