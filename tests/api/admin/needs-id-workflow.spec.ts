import { expect, test } from '@fixtures';

/**
 * Admin module — recorded gaps, not workarounds. This module has no FRD, so every one of these was
 * investigated directly against live behaviour rather than checked against a spec.
 */

test.describe('Admin module · recorded gaps', () => {
  test('admin-role-posting-suspended-list: no live test (requestType enum Unknown/Requires Clarification)', () => {
    test.skip(
      true,
      'getSuspendOrTerminateEmployee always 400s "requestType is Empty or Invalid" (or "...is ' +
        'required" when omitted/null). Tried live 2026-09-26: SUSPEND, TERMINATE, SUSPEND_TERMINATE, ' +
        'ACTIVE, INACTIVE, ALL, Suspended, suspended, SUSPENDED_TERMINATED, BOTH, numeric 0/1/2, ' +
        "boolean true, and alternate field names (status/type/requestStatus/employeeStatus) — none " +
        'accepted. The originally documented "SUSPENDED" (owner\'s PDF) is also rejected. No frontend ' +
        'source was available to confirm the real value. Needs the dev to confirm the accepted ' +
        'requestType enum before this can be driven live without risking a false CRITICAL.',
    );
    expect(true, 'placeholder — this test body never runs past test.skip above').toBe(true);
  });

  test('admin-role-posting-save / -update / -delete / -suspend-terminate: no live test (ADMIN_ROLE_POSTING_LIVE is documented but unwired)', () => {
    test.skip(
      true,
      'These four provision/mutate a real, non-reversible external KSMACC account ' +
        '(RolePostingSetUpServiceImpl.sendKPostUserRequest → login.ksmacc.in) — the same class of ' +
        'irreversible external side effect as KOS\'s metered AI, meant to be held behind a second, ' +
        'explicit, owner-authorized flag (ADMIN_ROLE_POSTING_LIVE) on top of ADMIN_LIFECYCLE. Found ' +
        '2026-09-26: no code anywhere in this repo actually reads process.env.ADMIN_ROLE_POSTING_LIVE ' +
        '— the flag exists only in a comment, so this flow could not run even with it set. Wiring it ' +
        'up (and running it) needs explicit owner sign-off first, since every run provisions an ' +
        'account with no clean teardown path — not done unilaterally.',
    );
    expect(true, 'placeholder — this test body never runs past test.skip above').toBe(true);
  });
});
