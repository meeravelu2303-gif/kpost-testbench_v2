import { env } from '@config/env';
import { workbookContract } from '../../contract/workbook-contract';
import type { EndpointDefinition } from '../../registry/endpoint-definition';
import type { KpostEndpointConfig, UndocumentedKpostEndpointConfig } from '../kpost/kpost-endpoint';

const KMAIL_PREFIX = env.KMAIL_PATH_PREFIX;

/**
 * A KMail endpoint (`kmail-api`, post-login, KMail envelope). The request path gets
 * `KMAIL_PATH_PREFIX` prepended, while schema lookup uses the unprefixed contract path (e.g.
 * `/v2/sentMail/postMail/`).
 */
export function defineKmailEndpoint(config: KpostEndpointConfig): EndpointDefinition {
  const documentedPath = config.contractPath ?? config.path;
  const contract = workbookContract(
    'kmail-api',
    config.contractMethod ?? config.method,
    documentedPath,
  );

  return {
    id: config.id,
    method: config.method,
    path: `${KMAIL_PREFIX}${config.path}`,
    // The unprefixed documented path — used for the schema lookup and coverage reconciliation.
    contractPath: documentedPath,
    contractMethod: config.contractMethod,
    suite: 'kmail-api',
    responseContract: 'kmail',
    summary: config.summary,
    // Carried through so coverage invariants can read the written reason.
    note: config.note,
    tags: ['kmail-api', 'kmail', ...(config.tags ?? [])],
    requirements: config.requirements,
    authentication: config.authentication ?? { required: true },
    expectedStatus: config.expectedStatus,
    envelope: config.envelope,
    contentType: config.contentType,
    request: config.request,
    // The workbook wins; the definition's schema (typed from the live client's body) fills in only
    // where the workbook row documents no body, so negative request cases can still be generated.
    requestSchema: contract.requestSchema ?? config.requestSchema,
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
    // Mirrors `defineKpostEndpoint`.
    database: config.database,
  };
}

/**
 * A KMail endpoint the web app calls but the workbook omits; `evidence` names the frontend call
 * site.
 */
export function defineUndocumentedKmailEndpoint(
  config: UndocumentedKpostEndpointConfig,
): EndpointDefinition {
  return {
    id: config.id,
    method: config.method,
    path: `${KMAIL_PREFIX}${config.path}`,
    suite: 'kmail-api',
    responseContract: 'kmail',
    summary: config.summary,
    note: `UNDOCUMENTED IN WORKBOOK — confirmed from frontend source (${config.evidence}). ${config.note ?? ''}`.trim(),
    // No 'undocumented-contract' tag (lint:tags would reject it); the note prefix marks it instead.
    tags: ['kmail-api', 'kmail', ...(config.tags ?? [])],
    requirements: config.requirements,
    authentication: config.authentication ?? { required: true },
    expectedStatus: config.expectedStatus,
    envelope: config.envelope,
    contentType: config.contentType,
    request: config.request,
    requestSchema: config.requestSchema,
    responseSchema: config.responseSchema,
    pathParamsSchema: config.pathParamsSchema,
    querySchema: config.querySchema,
    destructive: config.destructive,
    sideEffect: config.sideEffect,
    productionSafe: config.productionSafe,
    validations: config.validations,
    skipValidators: config.skipValidators,
    businessRules: config.businessRules,
    security: config.security,
    performance: config.performance,
  };
}
