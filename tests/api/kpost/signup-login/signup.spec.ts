import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * WHAT is tested: the signup-screen front door — availability checks and the workbook's GET
 * artifact. HOW is owned by the central validation engine — see src/validators/.
 *
 * No sweep anywhere in the repo previously targeted the `signup` tag at all, so these 5 endpoints'
 * only coverage was their own hand-written specs. `signup-login-signup` and
 * `signup-login-admin-registration` are `@destructive` (sideEffect:'global') and so are excluded from
 * collection on this environment by `playwright.config.ts`'s own `grepInvert`, same as
 * `login.spec.ts`'s destructive endpoints — this sweep's real, visible contribution is the other 3:
 * `signup-login-signup-get`, `signup-login-kpost-id-exist`, `signup-login-kpost-id-suggestions`.
 */
test.describe('KPost Signup · contract validation', () => {
  describeEndpointCases({ tags: ['signup'] });
});
