import { testData } from '@config/test-data.config';
import type { EndpointDefinition } from '../../registry/endpoint-definition';
import { body } from '../kpost/kpost-endpoint';
import { COMPANY_SCOPED_READ, defineAdminEndpoint } from './admin-endpoint';

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
    requestSchema: COMPANY_SCOPED_READ,
    destructive: false,
    productionSafe: true,
  }),
  defineAdminEndpoint({
    id: 'admin-workplace-tier-attribute-get',
    method: 'POST',
    path: '/adminTierAttribute/getAttribute',
    summary: 'Get one workplace tier attribute by id',
    tags: ['workplace-tier-attribute', 'needs-id'],
    request: body(() => ({ id: 1 })),
    destructive: false,
    note: '"get one by id" is inferred from the shared DTO shape (no ByCompanyId suffix) — confirm live',
  }),
  defineAdminEndpoint({
    id: 'admin-workplace-tier-attribute-save',
    method: 'POST',
    path: '/adminTierAttribute/save',
    summary: 'Create a workplace tier attribute (level)',
    tags: ['workplace-tier-attribute'],
    // AdminTierAttributeController.save takes List<AdminTierAttributeEntity>, not a single object
    // (confirmed from source 2026-10-05) — a bare object 400s "Request body is invalid".
    request: body(() => [
      {
        companyId: companyId(),
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
    // AdminTierVariableController.save takes List<AdminTierVariableEntity>, not a single object
    // (confirmed from source 2026-10-05) — a bare object 400s "Request body is invalid".
    request: body(() => [
      {
        companyId: companyId(),
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
    id: 'admin-workplace-tier-variable-get-all',
    method: 'GET',
    path: '/adminTierVariable/getAllVariable',
    summary: 'List all workplace tier variables (no parameters)',
    tags: ['workplace-tier-variable'],
    destructive: false,
    productionSafe: true,
  }),
  defineAdminEndpoint({
    id: 'admin-workplace-tier-variable-reporting-hierarchy',
    method: 'POST',
    path: '/adminTierVariable/getAllReportingVariableHierarchy',
    summary: 'Read the reporting hierarchy under a workplace tier variable',
    tags: ['workplace-tier-variable'],
    // Keyed by a runtime variable id a write creates — not driven on live standalone.
    request: body(() => ({ id: 1 })),
  }),

  // ---- Work Place Location Setup -------------------------------------------------------------
  defineAdminEndpoint({
    id: 'admin-workplace-location-all',
    method: 'POST',
    path: '/location/getAllLocation',
    summary: 'List all workplace locations for the company',
    tags: ['workplace-location'],
    request: body(() => ({ companyId: companyId() })),
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
    request: body(() => ({ companyId: companyId(), attributeId: 1, variableId: 1 })),
  }),
  defineAdminEndpoint({
    id: 'admin-workplace-location-by-id',
    method: 'POST',
    path: '/location/getLocationById',
    summary: 'Get one workplace location by id',
    tags: ['workplace-location'],
    request: body(() => ({ id: 1 })),
  }),
  defineAdminEndpoint({
    id: 'admin-workplace-location-reporting-name',
    method: 'POST',
    path: '/location/getReportingLocationName',
    summary: 'Read the reporting location name for a location',
    tags: ['workplace-location', 'needs-id'],
    request: body(() => ({ id: 1 })),
    destructive: false,
    note: '"get one by id" is inferred from the shared DTO shape — confirm live',
  }),
  defineAdminEndpoint({
    id: 'admin-workplace-location-save',
    method: 'POST',
    path: '/location/save',
    summary: 'Create a workplace location',
    tags: ['workplace-location'],
    // LocationController.save takes List<LocationEntity>, not a single object (confirmed from
    // source 2026-10-05) — a bare object 400s "Request body is invalid".
    request: body(() => [
      {
        companyId: companyId(),
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
    tags: ['workplace-hierarchy', 'needs-id'],
    // Verified on the test host (2026-09-19): with ONLY `{ companyId }` (the owner's PDF payload) the
    // live backend answers 400 `"parentAttributeId is required"` — so the PDF is INCOMPLETE for this
    // one endpoint; it genuinely needs a REAL runtime `parentAttributeId` (a created workplace tier).
    // So it is NOT productionSafe (a standalone call 400s and reads as a false CRITICAL); the admin
    // lifecycle drives it with an attribute id it created. Left the placeholder fields for the lifecycle.
    request: body(() => ({
      companyId: companyId(),
      parentVariableId: '0',
      parentAttributeId: '0',
    })),
    destructive: false,
    note: 'needs a runtime parentAttributeId from a created workplace tier (confirmed 400 without it)',
  }),
  defineAdminEndpoint({
    id: 'admin-workplace-organization',
    method: 'GET',
    path: '/workplaceHierarchy/getOrganization',
    summary: 'Read the assembled organization tree (no parameters)',
    tags: ['workplace-hierarchy'],
    destructive: false,
    productionSafe: true,
  }),
  /*
   * save/update/delete on WorkPlaceHierarchyEntity have NO companyId field at all — the entity is a
   * pure mapping between an already-created attributeId/variableId (and optional reporting-side
   * counterparts), confirmed from the live contract's schema. A placeholder id cannot create or
   * touch a real record, so these run the generic request/security/auth battery only (same
   * convention as every other update/delete placeholder below) — they are not a real create/clean
   * lifecycle the way the already-covered tier endpoints are.
   */
  defineAdminEndpoint({
    id: 'admin-workplace-hierarchy-save',
    method: 'POST',
    path: '/workplaceHierarchy/save',
    summary: 'Create a workplace hierarchy mapping',
    tags: ['workplace-hierarchy', 'needs-id'],
    request: body(() => ({ attributeId: '1', variableId: '1' })),
    destructive: true,
    sideEffect: 'data',
  }),
  defineAdminEndpoint({
    id: 'admin-workplace-hierarchy-update',
    method: 'POST',
    path: '/workplaceHierarchy/update',
    summary: 'Update a workplace hierarchy mapping',
    tags: ['workplace-hierarchy', 'needs-id'],
    request: body(() => ({ id: '1', attributeId: '1', variableId: '1' })),
    destructive: true,
    sideEffect: 'data',
  }),
  defineAdminEndpoint({
    id: 'admin-workplace-hierarchy-delete',
    method: 'POST',
    path: '/workplaceHierarchy/delete',
    summary: 'Delete a workplace hierarchy mapping',
    tags: ['workplace-hierarchy', 'needs-id'],
    request: body(() => ({ id: '1' })),
    destructive: true,
    sideEffect: 'data',
  }),
];
