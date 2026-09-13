import { ApiRegistry } from '../registry/api-registry';
import { adminApis } from './admin.api';
import { loginApi } from './auth.api';
import { companyApis } from './companies.api';
import { dictionaryApis } from './dictionary.api';
import { healthCheckApi } from './health.api';
import { commonApis } from './kpost/common/index';
import { groupApis } from './kpost/group/index';
import { katchupApis } from './kpost/katchup/index';
import { dashboardApis } from './kpost/dashboard/index';
import { profileApis } from './kpost/profile/index';
import { signupLoginApis } from './kpost/signup-login/index';
import { kmailApis } from './kmail.api';
import { userApis } from './users.api';

/**
 * Every endpoint under test, across all KPost modules.
 *
 * Each definition carries its `suite`, which decides the host it is called on and — when a
 * defect is found — the Bugzilla product, component and developer it goes to. Adding an
 * endpoint is one definition; adding a module is one entry in ownership.config.ts.
 */
export const apiRegistry = new ApiRegistry().register(
  // KPost core API (suite: kpost-api, default) — Jaganathan Murthy
  healthCheckApi,
  loginApi,
  ...userApis,
  ...companyApis,
  ...dictionaryApis,
  // KPost common module - public endpoints, no token required.
  ...commonApis,
  // KPost Signup & Login - the gate, and the source of every module's token.
  ...signupLoginApis,
  // KPost Katchup - instant messaging. See docs/katchup-flow.md.
  ...katchupApis,
  // KPost Group - group membership; underpins Katchup group messaging (FR-K06).
  ...groupApis,
  // KPost Profile - the account owner's own profile (undocumented module).
  ...profileApis,
  // KPost Dashboard - the Home recent-messages panel (undocumented module).
  ...dashboardApis,
  // Admin module — Jaganathan Murthy. Loaded from its own spec when ADMIN_API_BASE_URL is set.
  ...adminApis,
  // KMail module — Jitendra Kumar. Loaded from its own spec when KMAIL_API_BASE_URL is set.
  ...kmailApis,
);
