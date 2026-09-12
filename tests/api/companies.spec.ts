import { describeEndpointContracts } from '@engine/contract-suite';
import { test } from '@fixtures';

test.describe('Companies API', () => {
  describeEndpointContracts({ tags: ['companies'] });
});
