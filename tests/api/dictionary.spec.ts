import { describeEndpointContracts } from '@engine/contract-suite';
import { test } from '@fixtures';

// Endpoints come from openapi/dictionary.openapi.json via the endpoint loader.
test.describe('Dictionary API', () => {
  describeEndpointContracts({ tags: ['dictionary'] });
});
