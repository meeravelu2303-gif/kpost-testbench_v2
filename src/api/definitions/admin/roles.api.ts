import { env } from '@config/env';
import type { EndpointDefinition } from '../../registry/endpoint-definition';
import { body } from '../kpost/kpost-endpoint';
import { COMPANY_SCOPED_READ, defineAdminEndpoint } from './admin-endpoint';

/**
 * Admin Role Posting Setup and Assign Role Posting (one role per employee): reads plus gated
 * writes.
 */

/*
 * Role-posting writes are `external` and refused unless ADMIN_ROLE_POSTING_LIVE is set; then only
 * role-posting-lifecycle.spec.ts sends them. The `role-posting-mutation` tag keeps them out of
 * every fuzzer.
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
    // The value the Admin UI sends. Its 400 "requestType is Empty or Invalid" means the list is
    // empty, not that the input is bad; an empty list should be 200 + [].
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
    // A read (POSTs default to destructive): lets an id-keyed read-back run with allowLiveRead.
    destructive: false,
  }),

  // ---- writes (gated) ------------------------------------------------------------------------
  defineAdminEndpoint({
    id: 'admin-role-posting-save',
    method: 'POST',
    path: '/rolePosting/save',
    summary: 'Assign a role posting to an employee (workplace + HR role)',
    // Creates a KSMACC/KPost user through hard-coded external services, so the guard treats it as
    // `external`.
    tags: ['role-posting', 'role-posting-mutation'],
    // The controller takes a list; a bare object 400s "Request body is invalid".
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
    // Same external calls as save.
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
    // Same external calls as save.
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
    // Same external calls as save.
    tags: ['role-posting', 'role-posting-mutation'],
    // Only ever an expendable member the lifecycle created. `requestType` must be exactly 'suspend'
    // | 'terminate' | 'revoked' (anything else 500s), as the Admin UI sends it.
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
