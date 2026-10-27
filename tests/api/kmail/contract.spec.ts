import { describeEndpointContracts } from '@engine/contract-suite';
import { kmailAuthGate } from '@fixtures/kmail-auth-gate';
import { test } from '@fixtures';

// The engine over every KMail API endpoint. Skips until KMAIL_API_BASE_URL is configured.
test.describe('KMail API', { tag: ['@api', '@platform', '@regression'] }, () => {
  // Gated while KMail refuses every valid KPost token (src/fixtures/kmail-auth-gate.ts).
  test.skip(kmailAuthGate() !== undefined, kmailAuthGate() ?? '');
  // `needs-login` endpoints stay registered (coverage, bug routing) but are not run here.
  describeEndpointContracts(
    { suites: ['kmail-api'], excludeTags: ['needs-login', 'not-in-use'] },
    { allowEmpty: true },
  );
});
