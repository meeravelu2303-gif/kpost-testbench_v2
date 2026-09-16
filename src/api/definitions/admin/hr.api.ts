import { testData } from '@config/test-data.config';
import type { EndpointDefinition } from '../../registry/endpoint-definition';
import { body } from '../kpost/kpost-endpoint';
import { defineAdminEndpoint } from './admin-endpoint';

/**
 * Admin module — **HR Breakdown Setup** (step 3 of the org-build). See `docs/admin-flow.md` §4.
 *
 *   hrSetUpTierAttribute/*  the HR TIERS (levels), e.g. Department / Designation / Role
 *   hrSetUpTierVariable/*    the HR VARIABLES (nodes), e.g. IT / Developer / Team Lead
 *
 * The workbook documents `companyId` as a STRING ("1") on the two HR reads (it is a number on the
 * workplace side) — a documented inconsistency; the payload sends it as documented so a real 400
 * would be a finding, not a test bug. Reads are company-scoped and live; writes are gated.
 */

const companyId = (): string => String(testData.businessMCompanyId);

export const adminHrApis: EndpointDefinition[] = [
  // ---- HR tiers (attributes) -----------------------------------------------------------------
  defineAdminEndpoint({
    id: 'admin-hr-tier-attribute-by-company',
    method: 'POST',
    path: '/hrSetUpTierAttribute/getAttributeByCompanyId',
    summary: 'List HR tier attributes (levels) for the company',
    tags: ['hr-tier-attribute'],
    // Documented as a string; sent as documented (a 400 on the number would be the real contract).
    request: body(() => ({ companyId: companyId() })),
    destructive: false,
    productionSafe: true,
  }),
  defineAdminEndpoint({
    id: 'admin-hr-tier-attribute-save',
    method: 'POST',
    path: '/hrSetUpTierAttribute/save',
    summary: 'Create an HR tier attribute (level)',
    tags: ['hr-tier-attribute'],
    request: body(() => ({
      companyId: companyId(),
      attributeName: `QA HR Tier ${Date.now()}`,
      createdBy: companyId(),
    })),
    destructive: true,
    sideEffect: 'data',
  }),
  defineAdminEndpoint({
    id: 'admin-hr-tier-attribute-update',
    method: 'POST',
    path: '/hrSetUpTierAttribute/update',
    summary: 'Update an HR tier attribute',
    tags: ['hr-tier-attribute'],
    request: body(() => ({ id: 1, companyId: companyId(), attributeName: 'QA HR Tier edited' })),
    destructive: true,
    sideEffect: 'data',
  }),
  defineAdminEndpoint({
    id: 'admin-hr-tier-attribute-delete',
    method: 'POST',
    path: '/hrSetUpTierAttribute/delete',
    summary: 'Delete an HR tier attribute',
    tags: ['hr-tier-attribute'],
    request: body(() => ({ id: 1 })),
    destructive: true,
    sideEffect: 'data',
  }),

  // ---- HR variables (nodes) ------------------------------------------------------------------
  defineAdminEndpoint({
    id: 'admin-hr-tier-variable-list',
    method: 'POST',
    path: '/hrSetUpTierVariable/getHrSetUpTierVariable',
    summary: 'List HR tier variables (nodes) under a parent',
    tags: ['hr-tier-variable'],
    // parentVariableId 0 = root; companyId documented as a string on this read.
    request: body(() => ({ companyId: companyId(), parentVariableId: 0 })),
    destructive: false,
    productionSafe: true,
  }),
  defineAdminEndpoint({
    id: 'admin-hr-tier-variable-reporting-hierarchy',
    method: 'POST',
    path: '/hrSetUpTierVariable/getAllReportingHrTierVariableHierarchy',
    summary: 'Read the reporting hierarchy under an HR tier variable',
    tags: ['hr-tier-variable'],
    // Keyed by a runtime variable id a write creates — not driven on live standalone.
    request: body(() => ({ id: 1 })),
    destructive: false,
  }),
  defineAdminEndpoint({
    id: 'admin-hr-tier-variable-save',
    method: 'POST',
    path: '/hrSetUpTierVariable/save',
    summary: 'Create an HR tier variable (node)',
    tags: ['hr-tier-variable'],
    request: body(() => ({
      companyId: companyId(),
      attributeId: 1,
      variableName: `QA HR Var ${Date.now()}`,
      parentVariableId: 0,
    })),
    destructive: true,
    sideEffect: 'data',
  }),
  defineAdminEndpoint({
    id: 'admin-hr-tier-variable-update',
    method: 'POST',
    path: '/hrSetUpTierVariable/update',
    summary: 'Update an HR tier variable',
    tags: ['hr-tier-variable'],
    request: body(() => ({
      id: 1,
      companyId: companyId(),
      attributeId: 1,
      variableName: 'QA HR Var edited',
    })),
    destructive: true,
    sideEffect: 'data',
  }),
  defineAdminEndpoint({
    id: 'admin-hr-tier-variable-delete',
    method: 'POST',
    path: '/hrSetUpTierVariable/delete',
    summary: 'Delete an HR tier variable',
    tags: ['hr-tier-variable'],
    request: body(() => ({ id: 1 })),
    destructive: true,
    sideEffect: 'data',
  }),
];
