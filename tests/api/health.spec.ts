import { describeEndpointContracts } from '@engine/contract-suite';
import { test } from '@fixtures';

test.describe('Platform API', () => {
  describeEndpointContracts({ tags: ['platform'] });
});
