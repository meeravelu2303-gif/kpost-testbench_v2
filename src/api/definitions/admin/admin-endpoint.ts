import { workbookContract } from '../../contract/workbook-contract';
import type { EndpointDefinition } from '../../registry/endpoint-definition';
import type { KpostEndpointConfig } from '../kpost/kpost-endpoint';

/**
 * An **Admin module** endpoint. The Admin/HR-Setup module is its own suite (`admin-api`) on its own
 * host (`ADMIN_API_BASE_URL=https://adminmodule.kpostindia.com`), reached by BUSINESS_M/L admins from
 * the "Admin / HR Setup" nav item (BUSINESS_S manages members in-app instead). Full flow, endpoint→step
 * mapping and accounts: `docs/admin-flow.md`.
 *
 * Unlike KMail there is **no path prefix** — the host serves routes at root (`/adminTierAttribute/save`),
 * confirmed against `openapi/admin-api.openapi.json`. Schemas come from the `admin-api` contract
 * (generated from `Admin_module.xlsx`), and the module is **post-login**: the SAME KPost login token
 * authenticates it (SSO — owner-confirmed), so no separate auth profile shape is needed, only the right
 * principal (a business admin whose login mints the `companyID` claim).
 *
 * **Response envelope is `admin`**, measured from the backend source (`ApiResponseEnvelope.java`):
 * `{ value, status, statusCode, urlPath, error?, message? }` — the payload key is `value` (not `data`),
 * and any handled failure returns HTTP 500. Ids are MongoDB ObjectIds (24-hex) and `companyId` is a
 * string. See `response-contract.ts` and `docs/admin-flow.md`.
 */
export function defineAdminEndpoint(config: KpostEndpointConfig): EndpointDefinition {
  const contract = workbookContract(
    'admin-api',
    config.contractMethod ?? config.method,
    config.contractPath ?? config.path,
  );

  return {
    id: config.id,
    method: config.method,
    path: config.path,
    contractPath: config.contractPath,
    contractMethod: config.contractMethod,
    suite: 'admin-api',
    responseContract: 'admin',
    summary: config.summary,
    tags: ['admin-api', ...(config.tags ?? [])],
    requirements: config.requirements,
    // The Admin module is entirely post-login and driven by the BUSINESS_M admin: every route needs
    // that Bearer token. `business-m` is named explicitly because several principals share
    // COMPANY_ADMIN, and it authenticates via `adminUserLogin` (its per-principal login override).
    authentication: config.authentication ?? {
      required: true,
      role: 'COMPANY_ADMIN',
      principalKey: 'business-m',
    },
    expectedStatus: config.expectedStatus,
    envelope: config.envelope,
    contentType: config.contentType,
    request: config.request,
    requestSchema: contract.requestSchema,
    responseSchema: contract.responseSchema,
    destructive: config.destructive,
    sideEffect: config.sideEffect,
    productionSafe: config.productionSafe,
    otpDependent: config.otpDependent,
    validations: config.validations,
    skipValidators: config.skipValidators,
    businessRules: config.businessRules,
    security: config.security,
    performance: config.performance,
  };
}
