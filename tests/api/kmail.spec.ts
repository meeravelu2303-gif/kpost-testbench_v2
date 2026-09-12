import { describeEndpointContracts } from '@engine/contract-suite';
import { test } from '@fixtures';

// KMail module (separate repo). Defects file to the KMail API product — owner: Jitendra Kumar.
// Skips until KMAIL_API_BASE_URL is configured.
test.describe('KMail API', () => {
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
