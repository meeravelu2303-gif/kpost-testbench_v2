import { testData } from '@config/test-data.config';
import type { EndpointDefinition } from '../../registry/endpoint-definition';
import { body } from '../kpost/kpost-endpoint';
import { COMPANY_SCOPED_READ, defineAdminEndpoint } from './admin-endpoint';

/**
 * Admin module — **Department / Designation**, a third org-structure pair found only by diffing the
 * live OpenAPI contract against what `workplace.api.ts`/`hr.api.ts`/`tier-extra.api.ts` already
 * cover. No FRD or workbook row documents this pair; modeled from its MEASURED schema
 * (`Department`: `id`/`companyId`/`departmentName`/`abbreviation`/`code`; `Designation`: the same
 * plus `departmentId`/`parentDesignationId`/`departmentIdList`).
 *
 * `abbreviationAndCodeCreation` is modeled as a non-persisting PREVIEW/derive call (by analogy with
 * the already-covered `admin-kpostid-designation-suggestion` in `kpost/admin/user-management.api.ts`,
 * which generates a suggestion from a name without saving it) — confirm this inference once it has
 * actually been exercised live; if it turns out to persist a row, it needs reclassifying as
 * `destructive: true` with its own delete call.
 */

const companyId = (): string => String(testData.businessMCompanyId);

export const adminOrgStructureApis: EndpointDefinition[] = [
  // ---- department/* ---------------------------------------------------------------------------
  defineAdminEndpoint({
    id: 'admin-department-by-company',
    method: 'POST',
    path: '/department/getDepartmentByCompanyId',
    summary: 'List departments for the company',
    tags: ['department'],
    request: body(() => ({ companyId: companyId() })),
    requestSchema: COMPANY_SCOPED_READ,
    destructive: false,
    productionSafe: true,
  }),
  defineAdminEndpoint({
    id: 'admin-department-save',
    method: 'POST',
    path: '/department/save',
    summary: 'Create a department',
    tags: ['department'],
    // Confirmed from backend source 2026-10-05 (DepartmentController.saveDepartment takes
    // `List<Department>`, not a single object) — a bare object 400s "Request body is invalid".
    request: body(() => [
      { companyId: companyId(), departmentName: `QA Dept ${Date.now()}`, abbreviation: 'QAD', code: 'QAD' },
    ]),
    destructive: true,
    sideEffect: 'data',
  }),
  defineAdminEndpoint({
    id: 'admin-department-update',
    method: 'POST',
    path: '/department/update',
    summary: 'Update a department',
    tags: ['department'],
    request: body(() => ({ id: 1, companyId: companyId(), departmentName: 'QA Dept edited' })),
    destructive: true,
    sideEffect: 'data',
  }),
  defineAdminEndpoint({
    id: 'admin-department-delete',
    method: 'POST',
    path: '/department/delete',
    summary: 'Delete a department',
    tags: ['department'],
    request: body(() => ({ id: 1 })),
    destructive: true,
    sideEffect: 'data',
  }),
  defineAdminEndpoint({
    id: 'admin-department-abbreviation-code',
    method: 'POST',
    path: '/department/abbreviationAndCodeCreation',
    summary: 'Derive an abbreviation/code suggestion for a department name',
    tags: ['department'],
    // companyId removed 2026-10-05: confirmed from source (DepartmentController.
    // abbreviationAndCodeCreation) that this method never reads companyId at all — it only calls
    // departmentService.abbreviationAndCodeCreation(departmentName). Including it caused a false
    // "missing companyId should 4xx" finding (#879's companyId case). See
    // feedback_companyid_token_vs_payload_nuance.
    request: body(() => ({ departmentName: `QA Dept ${Date.now()}` })),
    destructive: false,
    productionSafe: true,
    note: 'modeled as a non-persisting preview call by analogy with admin-kpostid-designation-suggestion — confirm live',
  }),

  // ---- designation/* --------------------------------------------------------------------------
  defineAdminEndpoint({
    id: 'admin-designation-by-company-department',
    method: 'POST',
    path: '/designation/getDesignationByCompanyIdAndDepartmentId',
    summary: 'List designations for a company + department',
    tags: ['designation', 'needs-id'],
    // departmentId 1 is a placeholder — a real created department's id is needed for a non-empty
    // result, but the shape/validation battery runs regardless.
    request: body(() => ({ companyId: companyId(), departmentId: 1 })),
    destructive: false,
  }),
  defineAdminEndpoint({
    id: 'admin-designation-save',
    method: 'POST',
    path: '/designation/save',
    summary: 'Create a designation',
    tags: ['designation'],
    // DesignationController.save takes List<Designation>, not a single object (confirmed from
    // source 2026-10-05) — a bare object 400s "Request body is invalid".
    request: body(() => [
      {
        companyId: companyId(),
        departmentId: 1,
        designationName: `QA Designation ${Date.now()}`,
      },
    ]),
    destructive: true,
    sideEffect: 'data',
  }),
  defineAdminEndpoint({
    id: 'admin-designation-update',
    method: 'POST',
    path: '/designation/update',
    summary: 'Update a designation',
    tags: ['designation'],
    request: body(() => ({
      id: 1,
      companyId: companyId(),
      departmentId: 1,
      designationName: 'QA Designation edited',
    })),
    destructive: true,
    sideEffect: 'data',
  }),
  defineAdminEndpoint({
    id: 'admin-designation-delete',
    method: 'POST',
    path: '/designation/delete',
    summary: 'Delete a designation',
    tags: ['designation'],
    request: body(() => ({ id: 1 })),
    destructive: true,
    sideEffect: 'data',
  }),
  defineAdminEndpoint({
    id: 'admin-designation-abbreviation-code',
    method: 'POST',
    path: '/designation/abbreviationAndCodeCreation',
    summary: 'Derive an abbreviation/code suggestion for a designation name',
    tags: ['designation'],
    // companyId removed, departmentId added 2026-10-05: confirmed from source
    // (DesignationController.abbreviationAndCodeCreation) — this method requires designationName
    // and departmentId only; it never reads companyId at all. See
    // feedback_companyid_token_vs_payload_nuance.
    request: body(() => ({ departmentId: 1, designationName: `QA Designation ${Date.now()}` })),
    destructive: false,
    productionSafe: true,
    note: 'modeled as a non-persisting preview call by analogy with admin-kpostid-designation-suggestion — confirm live',
  }),
];
