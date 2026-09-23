import { describeEndpointContracts } from '@engine/contract-suite';
import { kmailAuthGate } from '@fixtures/kmail-auth-gate';
import { test } from '@fixtures';

// KMail module (separate repo). Defects file to the KMail API product — owner: Jitendra Kumar.
// Skips until KMAIL_API_BASE_URL is configured.
test.describe('KMail API', () => {
  // Gated while KMail refuses every valid KPost token — see src/fixtures/kmail-auth-gate.ts. Without
  // this, the `tests/api/kmail` path filter matched this ungated file alongside the gated directory,
  // and it drove every KMail endpoint into a 401 — flooding the report with downstream noise from one
  // root cause. Re-enabled in one step by KMAIL_AUTH_FIXED=true once the auth regression is fixed.
  test.skip(kmailAuthGate() !== undefined, kmailAuthGate() ?? '');
  /*
   * Every auto-loaded KMail endpoint is tagged `needs-login`: the live service answers 403 without
   * a token. They stay registered (so coverage still counts them and bug routing still works) and
   * come back into the run automatically once Signup & Login can issue one.
   */
  describeEndpointContracts(
    { suites: ['kmail-api'], excludeTags: ['needs-login'] },
    { allowEmpty: true },
  );
});
