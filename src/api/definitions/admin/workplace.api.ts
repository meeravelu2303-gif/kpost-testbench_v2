import { testData } from '@config/test-data.config';
import type { EndpointDefinition } from '../../registry/endpoint-definition';
import { body } from '../kpost/kpost-endpoint';
import { COMPANY_SCOPED_READ, defineAdminEndpoint } from './admin-endpoint';

/**
 * Admin Work Place Setup (tiers, variables) and Work Place Location Setup. Company-scoped reads run
 * on live; writes are gated by ADMIN_LIFECYCLE and self-cleaning; id-keyed reads are `needs-id`.
 */

/** The caller's own company id (business-admin token). Payloads target only our own company. */
const companyId = (): string => String(testData.businessMCompanyId);

export const adminWorkplaceApis: EndpointDefinition[] = [
  // ---- Work Place Setup: tiers (attributes) --------------------------------------------------
  defineAdminEndpoint({
    id: 'admin-workplace-tier-attribute-by-company',
    method: 'POST',
    path: '/adminTierAttribute/getAttributeByCompanyId',
    summary: 'List workplace tier attributes (levels) for the company',
    tags: ['workplace-tier-attribute'],
    request: body(() => ({})),
    requestSchema: COMPANY_SCOPED_READ,
    destructive: false,
    productionSafe: true,
  }),
  defineAdminEndpoint({
    id: 'admin-workplace-tier-attribute-save',
    method: 'POST',
    path: '/adminTierAttribute/save',
    summary: 'Create a workplace tier attribute (level)',
    tags: ['workplace-tier-attribute'],
    // The controller takes a list; a bare object 400s "Request body is invalid".
    request: body(() => [
      {
        attributeName: `QA WP Tier ${Date.now()}`,
        createdBy: companyId(),
      },
    ]),
    destructive: true,
    sideEffect: 'data',
  }),
  defineAdminEndpoint({
    id: 'admin-workplace-tier-attribute-update',
    method: 'POST',
    path: '/adminTierAttribute/update',
    summary: 'Update a workplace tier attribute',
    tags: ['workplace-tier-attribute'],
    request: body(() => ({ id: 1, attributeName: 'QA WP Tier edited' })),
    destructive: true,
    sideEffect: 'data',
  }),
  defineAdminEndpoint({
    id: 'admin-workplace-tier-attribute-delete',
    method: 'POST',
    path: '/adminTierAttribute/delete',
    summary: 'Delete a workplace tier attribute',
    tags: ['workplace-tier-attribute'],
    request: body(() => ({ id: 1 })),
    destructive: true,
    sideEffect: 'data',
  }),

  // ---- Work Place Setup: variables (nodes) ---------------------------------------------------
  defineAdminEndpoint({
    id: 'admin-workplace-tier-variable-list',
    method: 'POST',
    path: '/adminTierVariable/getAdminTierVariable',
    summary: 'List workplace tier variables (nodes) under a parent',
    tags: ['workplace-tier-variable'],
    // parentVariableId 0 = the root level, so this reads without a runtime id.
    request: body(() => ({ parentVariableId: 0 })),
    requestSchema: COMPANY_SCOPED_READ,
    destructive: false,
    productionSafe: true,
  }),
  defineAdminEndpoint({
    id: 'admin-workplace-tier-variable-save',
    method: 'POST',
    path: '/adminTierVariable/save',
    summary: 'Create a workplace tier variable (node)',
    tags: ['workplace-tier-variable'],
    // The controller takes a list; a bare object 400s "Request body is invalid".
    request: body(() => [
      {
        attributeId: 1,
        variableName: `QA WP Var ${Date.now()}`,
        parentVariableId: 0,
      },
    ]),
    destructive: true,
    sideEffect: 'data',
  }),
  defineAdminEndpoint({
    id: 'admin-workplace-tier-variable-update',
    method: 'POST',
    path: '/adminTierVariable/update',
    summary: 'Update a workplace tier variable',
    tags: ['workplace-tier-variable'],
    request: body(() => ({
      id: 1,
      attributeId: 1,
      variableName: 'QA WP Var edited',
    })),
    destructive: true,
    sideEffect: 'data',
  }),
  defineAdminEndpoint({
    id: 'admin-workplace-tier-variable-delete',
    method: 'POST',
    path: '/adminTierVariable/delete',
    summary: 'Delete a workplace tier variable',
    tags: ['workplace-tier-variable'],
    request: body(() => ({ id: 1 })),
    destructive: true,
    sideEffect: 'data',
  }),
  defineAdminEndpoint({
    id: 'admin-workplace-tier-variable-reporting-hierarchy',
    method: 'POST',
    path: '/adminTierVariable/getAllReportingVariableHierarchy',
    summary: 'Read the reporting hierarchy under a workplace tier variable',
    tags: ['workplace-tier-variable'],
    // Keyed by a runtime variable id a write creates — not driven on live standalone.
    request: body(() => ({ id: 1 })),
    // A read (POSTs default to destructive): lets an id-keyed read-back run with allowLiveRead.
    destructive: false,
  }),

  // ---- Work Place Location Setup -------------------------------------------------------------
  defineAdminEndpoint({
    id: 'admin-workplace-location-all',
    method: 'POST',
    path: '/location/getAllLocation',
    summary: 'List all workplace locations for the company',
    tags: ['workplace-location'],
    request: body(() => ({})),
    requestSchema: COMPANY_SCOPED_READ,
    destructive: false,
    productionSafe: true,
  }),
  defineAdminEndpoint({
    id: 'admin-workplace-location-get',
    method: 'POST',
    path: '/location/getLocation',
    summary: 'Get locations under a workplace tier attribute + variable',
    tags: ['workplace-location'],
    // Keyed by a runtime attributeId/variableId a write creates — not driven on live standalone.
    request: body(() => ({ attributeId: 1, variableId: 1 })),
    // A read (POSTs default to destructive): lets an id-keyed read-back run with allowLiveRead.
    destructive: false,
  }),
  defineAdminEndpoint({
    id: 'admin-workplace-location-by-id',
    method: 'POST',
    path: '/location/getLocationById',
    summary: 'Get one workplace location by id',
    tags: ['workplace-location'],
    request: body(() => ({ id: 1 })),
    // A read (POSTs default to destructive): lets an id-keyed read-back run with allowLiveRead.
    destructive: false,
  }),
  defineAdminEndpoint({
    id: 'admin-workplace-location-save',
    method: 'POST',
    path: '/location/save',
    summary: 'Create a workplace location',
    tags: ['workplace-location'],
    // The controller takes a list; a bare object 400s "Request body is invalid".
    request: body(() => [
      {
        locationName: `QA Location ${Date.now()}`,
        addressLine1: 'QA address',
        pincode: testData.pinCode,
        country: 'India',
      },
    ]),
    destructive: true,
    sideEffect: 'data',
  }),
  defineAdminEndpoint({
    id: 'admin-workplace-location-update',
    method: 'POST',
    path: '/location/update',
    summary: 'Update a workplace location',
    tags: ['workplace-location'],
    request: body(() => ({ id: 1, locationName: 'QA Location edited' })),
    destructive: true,
    sideEffect: 'data',
  }),
  defineAdminEndpoint({
    id: 'admin-workplace-location-delete',
    method: 'POST',
    path: '/location/delete',
    summary: 'Delete a workplace location',
    tags: ['workplace-location'],
    request: body(() => ({ id: 1 })),
    destructive: true,
    sideEffect: 'data',
  }),

  // ---- Workplace hierarchy (read) ------------------------------------------------------------
  defineAdminEndpoint({
    id: 'admin-workplace-hierarchy',
    method: 'POST',
    path: '/workplaceHierarchy/getWorkPlaceHierarchy',
    summary: 'Read the assembled workplace hierarchy for the company',
    tags: ['workplace-hierarchy', 'needs-id'],
    // Needs a real `parentAttributeId` (missing from the PDF payload), so the admin lifecycle
    // drives it.
    request: body(() => ({
      parentVariableId: '0',
      parentAttributeId: '0',
    })),
    destructive: false,
    note: 'needs a runtime parentAttributeId from a created workplace tier (confirmed 400 without it)',
  }),
];
