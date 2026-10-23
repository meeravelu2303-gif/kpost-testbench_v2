import { expect, test } from '@fixtures';

/**
 * Admin **role posting** writes — a recorded, product-side block, not a workaround.
 *
 * `rolePosting/save`, `/update`, `/delete` and `/suspendOrTerminateEmployee` are never sent by the bench.
 * Read from Admin_Module (RolePostingSetUpServiceImpl, 2026-10-22): every outbound call they make goes to
 * HARD-CODED live hosts — `devapi2.kpostindia.com` (the live KPost API: kpostIdExist, addingUserByAdmin,
 * holdOrRelease, terminateUser) and `login.ksmacc.in` / `apigateway.ksmacc.in` — with no property to point
 * them elsewhere. So one save on the TEST Admin box creates a real account on the live KPost and KSMACC
 * platforms (kpostID derived from the HR designation + the admin's id), and delete never removes it.
 * The bench may only target test deployments (CLAUDE.md §1), so these stay blocked until the backend's
 * external hosts are configurable and set to test hosts.
 *
 * Enforced in code, not only here: the definitions carry `sideEffect: 'external'`, which the production
 * guard's SMS kill-switch refuses on every run, and `tests/api/admin.spec.ts` excludes the
 * `role-posting-mutation` tag from the engine even with ALLOW_DESTRUCTIVE_TESTS.
 *
 * The reads around them ARE covered: by-company, employees, by-company-and-employee, and the
 * suspended/terminated list (`reads-workflow.spec.ts`).
 */
test.describe('Admin · role posting writes (blocked: the test backend calls live hosts) @api @admin-api', () => {
  test('rolePosting save / update / delete / suspendOrTerminateEmployee are not sent', () => {
    test.skip(
      true,
      'BLOCKED by the product: the test Admin backend calls live devapi2.kpostindia.com and ' +
        'login/apigateway.ksmacc.in (hard-coded in RolePostingSetUpServiceImpl), so each run would create ' +
        'a real, unremovable account on the live platforms. Unblock: make those hosts configurable and ' +
        'point the test Admin box at testingapi + a KSMACC test host.',
    );
    expect(true, 'never reached — skipped above').toBe(true);
  });
});
