import { testData } from '@config/test-data.config';
import type { EndpointDefinition } from '../../registry/endpoint-definition';
import { body } from '../kpost/kpost-endpoint';
import { defineAdminEndpoint } from './admin-endpoint';

/**
 * Admin module — **Role Posting Setup** (step 4: map roles to a workplace) and **Assign Role
 * Posting** (step 6: assign a role to an employee — ONE role per employee). See `docs/admin-flow.md`.
 *
 *   rolePosting/getRolePostingByCompanyId    the role postings for the company (read)
 *   rolePosting/getEmployeeByCompanyId       the employees available to assign (read)
 *   rolePosting/save                          create/assign a role posting (hrVariable + location + employee)
 *   rolePosting/update                        change an employee's role posting
 *   rolePosting/delete                        remove a role posting
 *   rolePosting/suspendOrTerminateEmployee   suspend/terminate a member (DANGEROUS — expendable only)
 *   rolePosting/getSuspendOrTerminateEmployee list suspended/terminated members (read)
 */

const companyId = (): string => String(testData.businessMCompanyId);

export const adminRolesApis: EndpointDefinition[] = [
  // ---- reads ---------------------------------------------------------------------------------
  defineAdminEndpoint({
    id: 'admin-role-posting-by-company',
    method: 'POST',
    path: '/rolePosting/getRolePostingByCompanyId',
    summary: 'List role postings for the company',
    tags: ['role-posting'],
    request: body(() => ({ companyId: companyId() })),
    destructive: false,
    productionSafe: true,
  }),
  defineAdminEndpoint({
    id: 'admin-role-posting-employees',
    method: 'POST',
    path: '/rolePosting/getEmployeeByCompanyId',
    summary: 'List employees available for role assignment',
    tags: ['role-posting'],
    request: body(() => ({ companyId: companyId() })),
    destructive: false,
    productionSafe: true,
  }),
  defineAdminEndpoint({
    id: 'admin-role-posting-suspended-list',
    method: 'POST',
    path: '/rolePosting/getSuspendOrTerminateEmployee',
    summary: 'List suspended / terminated employees',
    tags: ['role-posting'],
    request: body(() => ({ companyId: companyId(), status: 'SUSPENDED' })),
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
    request: body(() => ({ companyId: companyId(), employeeId: 1 })),
  }),

  // ---- writes (gated) ------------------------------------------------------------------------
  defineAdminEndpoint({
    id: 'admin-role-posting-save',
    method: 'POST',
    path: '/rolePosting/save',
    summary: 'Assign a role posting to an employee (workplace + HR role)',
    tags: ['role-posting'],
    request: body(() => ({
      companyId: companyId(),
      employeeId: 1,
      hrVariableId: 1,
      locationId: 1,
    })),
    destructive: true,
    sideEffect: 'data',
  }),
  defineAdminEndpoint({
    id: 'admin-role-posting-update',
    method: 'POST',
    path: '/rolePosting/update',
    summary: "Change an employee's role posting",
    tags: ['role-posting'],
    request: body(() => ({ id: 1, employeeId: 1, rolePostingId: 1 })),
    destructive: true,
    sideEffect: 'data',
  }),
  defineAdminEndpoint({
    id: 'admin-role-posting-delete',
    method: 'POST',
    path: '/rolePosting/delete',
    summary: 'Remove a role posting',
    tags: ['role-posting'],
    request: body(() => ({ id: 1 })),
    destructive: true,
    sideEffect: 'data',
  }),
  defineAdminEndpoint({
    id: 'admin-role-posting-suspend-terminate',
    method: 'POST',
    path: '/rolePosting/suspendOrTerminateEmployee',
    summary: 'Suspend or terminate an employee (expendable QA member only)',
    tags: ['role-posting'],
    // DANGEROUS: only ever an expendable member the lifecycle created — never a seeded member.
    request: body(() => ({
      employeeId: 1,
      companyId: companyId(),
      status: 'SUSPENDED',
      reason: 'QA lifecycle',
    })),
    destructive: true,
    sideEffect: 'data',
  }),
];
