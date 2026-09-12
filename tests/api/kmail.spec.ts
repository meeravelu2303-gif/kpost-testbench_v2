import { describeEndpointContracts } from '@engine/contract-suite';
import { test } from '@fixtures';

// KMail module (separate repo). Defects file to the KMail API product — owner: Jitendra Kumar.
// Skips until KMAIL_API_BASE_URL is configured.
test.describe('KMail API', () => {
  describeEndpointContracts({ suites: ['kmail-api'] }, { allowEmpty: true });
});
