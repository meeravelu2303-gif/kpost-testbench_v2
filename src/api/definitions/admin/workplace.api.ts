import { testData } from '@config/test-data.config';
import type { EndpointDefinition } from '../../registry/endpoint-definition';
import { body } from '../kpost/kpost-endpoint';
import { defineAdminEndpoint } from './admin-endpoint';

/**
 * Admin module — **Work Place Setup** (step 1 of the org-build) and **Work Place Location Setup**
 * (step 2). See `docs/admin-flow.md` §4.
 *
 *   adminTierAttribute/*   the workplace TIERS (levels), e.g. "category of workplace"
 *   adminTierVariable/*     the workplace VARIABLES (nodes), e.g. "Head office" under a tier
 *   location/*              the workplace locations
 *   workplaceHierarchy      the assembled workplace tree (read)
 *
 * Company-scoped reads (`get*ByCompanyId`, `getAllLocation`, the hierarchy) run on live against the
 * caller's OWN company (`companyId` from the business-admin token). Writes create org structure, so
 * they are destructive and gated (`ADMIN_LIFECYCLE`), self-cleaning through the lifecycle spec. Reads
 * keyed by a runtime id (`getLocation`, `getLocationById`) need an id a write creates — `needs-id`.
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
    request: body(() => ({ companyId: companyId() })),
    destructive: false,
    productionSafe: true,
  }),
  defineAdminEndpoint({
    id: 'admin-workplace-tier-attribute-save',
    method: 'POST',
    path: '/adminTierAttribute/save',
    summary: 'Create a workplace tier attribute (level)',
    tags: ['workplace-tier-attribute'],
    request: body(() => ({
      companyId: companyId(),
      attributeName: `QA WP Tier ${Date.now()}`,
      createdBy: companyId(),
    })),
    destructive: true,
    sideEffect: 'data',
  }),
  defineAdminEndpoint({
    id: 'admin-workplace-tier-attribute-update',
    method: 'POST',
    path: '/adminTierAttribute/update',
    summary: 'Update a workplace tier attribute',
    tags: ['workplace-tier-attribute'],
    request: body(() => ({ id: 1, companyId: companyId(), attributeName: 'QA WP Tier edited' })),
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
    request: body(() => ({ companyId: companyId(), parentVariableId: 0 })),
    destructive: false,
    productionSafe: true,
  }),
  defineAdminEndpoint({
    id: 'admin-workplace-tier-variable-save',
    method: 'POST',
    path: '/adminTierVariable/save',
    summary: 'Create a workplace tier variable (node)',
    tags: ['workplace-tier-variable'],
    request: body(() => ({
      companyId: companyId(),
      attributeId: 1,
      variableName: `QA WP Var ${Date.now()}`,
      parentVariableId: 0,
    })),
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
      companyId: companyId(),
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
    destructive: false,
  }),

  // ---- Work Place Location Setup -------------------------------------------------------------
  defineAdminEndpoint({
    id: 'admin-workplace-location-all',
    method: 'POST',
    path: '/location/getAllLocation',
    summary: 'List all workplace locations for the company',
    tags: ['workplace-location'],
    request: body(() => ({ companyId: companyId() })),
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
    request: body(() => ({ companyId: companyId(), attributeId: 1, variableId: 1 })),
    destructive: false,
  }),
  defineAdminEndpoint({
    id: 'admin-workplace-location-by-id',
    method: 'POST',
    path: '/location/getLocationById',
    summary: 'Get one workplace location by id',
    tags: ['workplace-location'],
    request: body(() => ({ id: 1 })),
    destructive: false,
  }),
  defineAdminEndpoint({
    id: 'admin-workplace-location-save',
    method: 'POST',
    path: '/location/save',
    summary: 'Create a workplace location',
    tags: ['workplace-location'],
    request: body(() => ({
      companyId: companyId(),
      locationName: `QA Location ${Date.now()}`,
      addressLine1: 'QA address',
      pincode: testData.pinCode,
      country: 'India',
    })),
    destructive: true,
    sideEffect: 'data',
  }),
  defineAdminEndpoint({
    id: 'admin-workplace-location-update',
    method: 'POST',
    path: '/location/update',
    summary: 'Update a workplace location',
    tags: ['workplace-location'],
    request: body(() => ({ id: 1, companyId: companyId(), locationName: 'QA Location edited' })),
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
    tags: ['workplace-hierarchy'],
    request: body(() => ({ companyId: companyId() })),
    destructive: false,
    productionSafe: true,
  }),
];
