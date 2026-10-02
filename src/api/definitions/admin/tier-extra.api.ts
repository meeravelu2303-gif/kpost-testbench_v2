import { testData } from '@config/test-data.config';
import type { EndpointDefinition } from '../../registry/endpoint-definition';
import { body } from '../kpost/kpost-endpoint';
import { COMPANY_SCOPED_READ, defineAdminEndpoint } from './admin-endpoint';

/**
 * Admin module — a SECOND, parallel pair of tier/variable controllers discovered only by diffing
 * the live OpenAPI contract (`adminmodule.kpostindia.com/v3/api-docs`, 112 operations) against what
 * `workplace.api.ts`/`hr.api.ts` already cover: `attribute`/`variable` (no `adminTier` prefix) and
 * `hrTier`/`hrVariable` (no `hrSetUp` prefix). Confirmed real and live — not a stale/legacy alias —
 * via the server's own current contract, but their PURPOSE relative to `adminTierAttribute`/
 * `hrSetUpTierAttribute` is not documented anywhere available to this bench (no FRD, Excel workbook
 * silent on them, no frontend source checkout). Modeled from their MEASURED schema shape, which is
 * structurally identical to the already-covered siblings (`id`, `companyId`, `*Name`, `abbreviation`,
 * `code` [+ `attributeId`/`parentVariableId`/`parentAttributeId` on the variable side)).
 *
 * `getAttribute`/`getAttribute` (no `ByCompanyId` suffix) are UNDOCUMENTED beyond their shared DTO:
 * modeled as "get one by id" by analogy with `location/getLocationById` — the only other `getX`-not-
 * `getXByCompanyId` read in this module — and left `needs-id` (not productionSafe) since a placeholder
 * id cannot be confirmed to resolve to a real row. Confirm or correct this inference once the
 * endpoint has actually been exercised live.
 */

const companyId = (): string => String(testData.businessMCompanyId);

export const adminTierExtraApis: EndpointDefinition[] = [
  // ---- attribute/* (parallel to adminTierAttribute) ------------------------------------------
  defineAdminEndpoint({
    id: 'admin-attribute-by-company',
    method: 'POST',
    path: '/attribute/getAttributeByCompanyId',
    summary: 'List attributes (parallel tier controller) for the company',
    tags: ['attribute'],
    request: body(() => ({ companyId: companyId() })),
    requestSchema: COMPANY_SCOPED_READ,
    destructive: false,
    productionSafe: true,
    note: 'purpose relative to adminTierAttribute is undocumented; modeled from the live contract only',
  }),
  defineAdminEndpoint({
    id: 'admin-attribute-get',
    method: 'POST',
    path: '/attribute/getAttribute',
    summary: 'Get one attribute by id',
    tags: ['attribute', 'needs-id'],
    request: body(() => ({ id: 1 })),
    destructive: false,
    note: '"get one by id" is inferred from the shared DTO shape, not documented — confirm live',
  }),
  defineAdminEndpoint({
    id: 'admin-attribute-save',
    method: 'POST',
    path: '/attribute/save',
    summary: 'Create an attribute',
    tags: ['attribute'],
    request: body(() => ({ companyId: companyId(), attributeName: `QA Attr ${Date.now()}` })),
    destructive: true,
    sideEffect: 'data',
  }),
  defineAdminEndpoint({
    id: 'admin-attribute-update',
    method: 'POST',
    path: '/attribute/update',
    summary: 'Update an attribute',
    tags: ['attribute'],
    request: body(() => ({ id: 1, companyId: companyId(), attributeName: 'QA Attr edited' })),
    destructive: true,
    sideEffect: 'data',
  }),
  defineAdminEndpoint({
    id: 'admin-attribute-delete',
    method: 'POST',
    path: '/attribute/delete',
    summary: 'Delete an attribute',
    tags: ['attribute'],
    request: body(() => ({ id: 1 })),
    destructive: true,
    sideEffect: 'data',
  }),

  // ---- variable/* (parallel to adminTierVariable) ------------------------------------------
  defineAdminEndpoint({
    id: 'admin-variable-list',
    method: 'POST',
    path: '/variable/getVariable',
    summary: 'List variables (parallel tier controller) under a parent',
    tags: ['variable'],
    request: body(() => ({ companyId: companyId(), parentVariableId: 0 })),
    requestSchema: COMPANY_SCOPED_READ,
    destructive: false,
    productionSafe: true,
    note: 'purpose relative to adminTierVariable is undocumented; modeled from the live contract only',
  }),
  defineAdminEndpoint({
    id: 'admin-variable-save',
    method: 'POST',
    path: '/variable/save',
    summary: 'Create a variable',
    tags: ['variable'],
    request: body(() => ({
      companyId: companyId(),
      attributeId: 1,
      variableName: `QA Var ${Date.now()}`,
      parentVariableId: 0,
    })),
    destructive: true,
    sideEffect: 'data',
  }),
  defineAdminEndpoint({
    id: 'admin-variable-update',
    method: 'POST',
    path: '/variable/update',
    summary: 'Update a variable',
    tags: ['variable'],
    request: body(() => ({
      id: 1,
      companyId: companyId(),
      attributeId: 1,
      variableName: 'QA Var edited',
    })),
    destructive: true,
    sideEffect: 'data',
  }),
  defineAdminEndpoint({
    id: 'admin-variable-delete',
    method: 'POST',
    path: '/variable/delete',
    summary: 'Delete a variable',
    tags: ['variable'],
    request: body(() => ({ id: 1 })),
    destructive: true,
    sideEffect: 'data',
  }),

  // ---- hrTier/* (parallel to hrSetUpTierAttribute) -----------------------------------------
  defineAdminEndpoint({
    id: 'admin-hr-tier-extra-by-company',
    method: 'POST',
    path: '/hrTier/getAttributeByCompanyId',
    summary: 'List HR tiers (parallel controller) for the company',
    tags: ['hr-tier-extra'],
    request: body(() => ({ companyId: companyId() })),
    requestSchema: COMPANY_SCOPED_READ,
    destructive: false,
    productionSafe: true,
    note: 'purpose relative to hrSetUpTierAttribute is undocumented; modeled from the live contract only',
  }),
  defineAdminEndpoint({
    id: 'admin-hr-tier-extra-get',
    method: 'POST',
    path: '/hrTier/getAttribute',
    summary: 'Get one HR tier by id',
    tags: ['hr-tier-extra', 'needs-id'],
    request: body(() => ({ id: 1 })),
    destructive: false,
    note: '"get one by id" is inferred from the shared DTO shape, not documented — confirm live',
  }),
  defineAdminEndpoint({
    id: 'admin-hr-tier-extra-save',
    method: 'POST',
    path: '/hrTier/save',
    summary: 'Create an HR tier',
    tags: ['hr-tier-extra'],
    request: body(() => ({ companyId: companyId(), attributeName: `QA HR Tier2 ${Date.now()}` })),
    destructive: true,
    sideEffect: 'data',
  }),
  defineAdminEndpoint({
    id: 'admin-hr-tier-extra-update',
    method: 'POST',
    path: '/hrTier/update',
    summary: 'Update an HR tier',
    tags: ['hr-tier-extra'],
    request: body(() => ({ id: 1, companyId: companyId(), attributeName: 'QA HR Tier2 edited' })),
    destructive: true,
    sideEffect: 'data',
  }),
  defineAdminEndpoint({
    id: 'admin-hr-tier-extra-delete',
    method: 'POST',
    path: '/hrTier/delete',
    summary: 'Delete an HR tier',
    tags: ['hr-tier-extra'],
    request: body(() => ({ id: 1 })),
    destructive: true,
    sideEffect: 'data',
  }),

  // ---- hrVariable/* (parallel to hrSetUpTierVariable) --------------------------------------
  defineAdminEndpoint({
    id: 'admin-hr-variable-extra-list',
    method: 'POST',
    path: '/hrVariable/getVariable',
    summary: 'List HR variables (parallel controller) under a parent',
    tags: ['hr-variable-extra'],
    request: body(() => ({ companyId: companyId(), parentVariableId: 0 })),
    requestSchema: COMPANY_SCOPED_READ,
    destructive: false,
    productionSafe: true,
    note: 'purpose relative to hrSetUpTierVariable is undocumented; modeled from the live contract only',
  }),
  defineAdminEndpoint({
    id: 'admin-hr-variable-extra-save',
    method: 'POST',
    path: '/hrVariable/save',
    summary: 'Create an HR variable',
    tags: ['hr-variable-extra'],
    request: body(() => ({
      companyId: companyId(),
      attributeId: 1,
      variableName: `QA HR Var2 ${Date.now()}`,
      parentVariableId: 0,
    })),
    destructive: true,
    sideEffect: 'data',
  }),
  defineAdminEndpoint({
    id: 'admin-hr-variable-extra-update',
    method: 'POST',
    path: '/hrVariable/update',
    summary: 'Update an HR variable',
    tags: ['hr-variable-extra'],
    request: body(() => ({
      id: 1,
      companyId: companyId(),
      attributeId: 1,
      variableName: 'QA HR Var2 edited',
    })),
    destructive: true,
    sideEffect: 'data',
  }),
  defineAdminEndpoint({
    id: 'admin-hr-variable-extra-delete',
    method: 'POST',
    path: '/hrVariable/delete',
    summary: 'Delete an HR variable',
    tags: ['hr-variable-extra'],
    request: body(() => ({ id: 1 })),
    destructive: true,
    sideEffect: 'data',
  }),
];
