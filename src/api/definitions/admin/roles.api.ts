import { env } from '@config/env';
import type { EndpointDefinition } from '../../registry/endpoint-definition';
import { body } from '../kpost/kpost-endpoint';
import { COMPANY_SCOPED_READ, defineAdminEndpoint } from './admin-endpoint';

/**
 * Admin module — **Role Posting Setup** (step 4: map roles to a workplace) and **Assign Role
 * Posting** (step 6: assign a role to an employee — ONE role per employee). See `docs/modules/admin-flow.md`.
 *
 *   rolePosting/getRolePostingByCompanyId    the role postings for the company (read)
 *   rolePosting/getEmployeeByCompanyId       the employees available to assign (read)
 *   rolePosting/save                          create/assign a role posting (hrVariable + location + employee)
 *   rolePosting/update                        change an employee's role posting
 *   rolePosting/delete                        remove a role posting
 *   rolePosting/suspendOrTerminateEmployee   suspend/terminate a member (DANGEROUS — expendable only)
 *   rolePosting/getSuspendOrTerminateEmployee list suspended/terminated members (read)
 */

/*
 * Role-posting writes are refused on every run (`external`) unless the owner-authorized lifecycle flag is set
 * (2026-10-23: KPost calls go to testingapi; KSMACC has no test server and the live one is accepted for the QA
 * testing companies, #13234 WONTFIX). With ADMIN_ROLE_POSTING_LIVE=true they are QA-company test-data writes
 * for `role-posting-lifecycle.spec.ts` only; the `role-posting-mutation` tag keeps them out of every fuzzer.
 */
const ROLE_POSTING_SIDE_EFFECT = env.ADMIN_ROLE_POSTING_LIVE
  ? ('data' as const)
  : ('external' as const);

export const adminRolesApis: EndpointDefinition[] = [
  // ---- reads ---------------------------------------------------------------------------------
  defineAdminEndpoint({
    id: 'admin-role-posting-by-company',
    method: 'POST',
    path: '/rolePosting/getRolePostingByCompanyId',
    summary: 'List role postings for the company',
    tags: ['role-posting'],
    request: body(() => ({})),
    requestSchema: COMPANY_SCOPED_READ,
    destructive: false,
    productionSafe: true,
  }),
  defineAdminEndpoint({
    id: 'admin-role-posting-employees',
    method: 'POST',
    path: '/rolePosting/getEmployeeByCompanyId',
    summary: 'List employees available for role assignment',
    tags: ['role-posting'],
    request: body(() => ({})),
    requestSchema: COMPANY_SCOPED_READ,
    destructive: false,
    productionSafe: true,
  }),
  defineAdminEndpoint({
    id: 'admin-role-posting-suspended-list',
    method: 'POST',
    path: '/rolePosting/getSuspendOrTerminateEmployee',
    summary: 'List suspended / terminated employees',
    tags: ['role-posting'],
    // The value the Admin UI sends (EmployeeManagement/Suspend.js:302 'suspend', Terminate.js:205
    // 'terminate'); the backend accepts any non-empty requestType (RolePostingSetUpController:330).
    // Its 400 "requestType is Empty or Invalid" is NOT an input error: it is what the controller
    // answers when the list is EMPTY (:348). The 2026-09 probes read that as a bad enum — every value
    // tried was valid, the QA company simply had nobody suspended. An empty list should be 200 + [].
    request: body(() => ({ requestType: 'suspend' })),
    destructive: false,
    productionSafe: true,
  }),
  defineAdminEndpoint({
    id: 'admin-role-posting-by-company-and-employee',
    method: 'POST',
    path: '/rolePosting/getRolePostingByCompanyIdAndEmployeeId',
    summary: "Read one employee's role posting",
    tags: ['role-posting'],
    // Keyed by a runtime employeeId a write creates — not driven on live standalone.
    request: body(() => ({ employeeId: 1 })),
  }),

  // ---- writes (gated) ------------------------------------------------------------------------
  defineAdminEndpoint({
    id: 'admin-role-posting-save',
    method: 'POST',
    path: '/rolePosting/save',
    summary: 'Assign a role posting to an employee (workplace + HR role)',
    /*
     * Backend-confirmed (Admin_Module/RolePostingSetUpServiceImpl.save -> createRolePostingCommunication):
     * calls real, hardcoded external services (login.ksmacc.in, devapi2.kpostindia.com) to create a
     * KSMACC/KPost user. `sideEffect:'external'` (not just the `role-posting-mutation` tag exclusion)
     * so `production-guard.ts` itself refuses this on live — not only test-file convention — matching
     * the guard's own "external (SMS/account provisioning)" category (see its write-fuzz comment).
     */
    tags: ['role-posting', 'role-posting-mutation'],
    // RolePostingSetUpController.save takes List<RolePostingRequestObject>, not a single object
    // (confirmed from source 2026-10-05) — a bare object 400s "Request body is invalid". Never
    // actually sent live anyway (sideEffect:'external' above), but kept correct for shape/negative
    // probes run off-production.
    request: body(() => [
      {
        employeeId: 1,
        hrVariableId: 1,
        locationId: 1,
      },
    ]),
    destructive: true,
    sideEffect: ROLE_POSTING_SIDE_EFFECT,
  }),
  defineAdminEndpoint({
    id: 'admin-role-posting-update',
    method: 'POST',
    path: '/rolePosting/update',
    summary: "Change an employee's role posting",
    // Backend-confirmed (Admin_Module/RolePostingSetUpServiceImpl.update -> createCommunication /
    // createCommunicationForRellocate): same external-call class as save — see the note there.
    tags: ['role-posting', 'role-posting-mutation'],
    request: body(() => ({ id: 1, employeeId: 1, rolePostingId: 1 })),
    destructive: true,
    sideEffect: ROLE_POSTING_SIDE_EFFECT,
  }),
  defineAdminEndpoint({
    id: 'admin-role-posting-delete',
    method: 'POST',
    path: '/rolePosting/delete',
    summary: 'Remove a role posting',
    // Same external-call class as save/update — see the note there.
    tags: ['role-posting', 'role-posting-mutation'],
    request: body(() => ({ id: 1 })),
    destructive: true,
    sideEffect: ROLE_POSTING_SIDE_EFFECT,
  }),
  defineAdminEndpoint({
    id: 'admin-role-posting-suspend-terminate',
    method: 'POST',
    path: '/rolePosting/suspendOrTerminateEmployee',
    summary: 'Suspend or terminate an employee (expendable QA member only)',
    // Same external-call class as save/update/delete — see the note there.
    tags: ['role-posting', 'role-posting-mutation'],
    // DANGEROUS: only ever an expendable member the lifecycle created — never a seeded member.
    // The Admin UI's body (EmployeeManagement/Suspend.js:273, Terminate.js:176, Revoke.js:168):
    // requestType is matched EXACTLY against 'suspend' | 'terminate' | 'revoked'
    // (RolePostingSetUpServiceImpl:901-918; any other value NPEs into a 500). The PDF's "SUSPENDED"
    // never matches. Never sent: suspend/revoke call devapi2 holdOrRelease, terminate calls
    // apigateway.ksmacc.in + devapi2 terminateUser — live hosts, hard-coded.
    request: body(() => ({
      rolePostingId: '000000000000000000000000',
      employeeId: '000000000000000000000000',
      requestType: 'suspend',
      reason: 'QA lifecycle',
      remarks: 'QA lifecycle',
    })),
    destructive: true,
    sideEffect: ROLE_POSTING_SIDE_EFFECT,
  }),
];
