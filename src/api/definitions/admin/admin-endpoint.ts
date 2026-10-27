import { z } from 'zod';
import { workbookContract } from '../../contract/workbook-contract';
import type { EndpointDefinition } from '../../registry/endpoint-definition';
import type { KpostEndpointConfig } from '../kpost/kpost-endpoint';
import { ADMIN_RESPONSE_SCHEMAS } from './response-schemas';

/**
 * Request schema for a company-scoped admin read: empty, since the company comes from the token.
 * Open, so a read may also send a filter; it stops the engine fuzzing DTO fields the read ignores.
 */
export const COMPANY_SCOPED_READ = z.object({});

/**
 * Strips `companyId` from a contract schema: Admin APIs take the company from the token. The
 * cross-tenant security specs still send a foreign one on purpose.
 */
function withoutCompanyId(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema;
  const s = schema as Record<string, unknown>;
  if (s.type === 'array') return { ...s, items: withoutCompanyId(s.items) };
  if (s.properties && typeof s.properties === 'object') {
    const { companyId: _dropped, ...properties } = s.properties as Record<string, unknown>;
    const required = Array.isArray(s.required)
      ? s.required.filter((field) => field !== 'companyId')
      : s.required;
    return { ...s, properties, ...(required !== undefined ? { required } : {}) };
  }
  return schema;
}

/**
 * An Admin/HR-Setup endpoint (`admin-api`): routes at the host root, schemas from the generated
 * admin contract, the KPost login token, and the `admin` response envelope. See
 * `docs/modules/admin-flow.md`.
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
    // Carried through so coverage invariants can read the written reason.
    note: config.note,
    tags: ['admin-api', ...(config.tags ?? [])],
    requirements: config.requirements,
    // Every route needs the BUSINESS_M admin's token; named explicitly since several principals
    // share COMPANY_ADMIN.
    authentication: config.authentication ?? {
      required: true,
      role: 'COMPANY_ADMIN',
      principalKey: 'business-m',
    },
    expectedStatus: config.expectedStatus,
    envelope: config.envelope,
    contentType: config.contentType,
    request: config.request,
    requestSchema:
      config.requestSchema ??
      (withoutCompanyId(contract.requestSchema) as EndpointDefinition['requestSchema']),
    // The backend classes' shapes (response-schemas.ts); the workbook documents no Admin responses.
    responseSchema:
      config.responseSchema ?? ADMIN_RESPONSE_SCHEMAS[config.id] ?? contract.responseSchema,
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
