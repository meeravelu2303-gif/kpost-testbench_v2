import { env } from '@config/env';
import { workbookContract } from '../../contract/workbook-contract';
import type { EndpointDefinition } from '../../registry/endpoint-definition';
import type { KpostEndpointConfig, UndocumentedKpostEndpointConfig } from '../kpost/kpost-endpoint';

/**
 * A **KMail** endpoint. KMail is its own suite (`kmail-api`) on its own host. The schemas come from
 * the `kmail-api` contract; the response envelope is KMail's own (`RESPONSE_CONTRACTS.kmail`), and the
 * whole module is post-login.
 *
 * The host serves KMail under a path prefix (prod `/kmail5/v2`, test `/testkmail/v2`), configurable
 * via `KMAIL_PATH_PREFIX`. `KMAIL_API_BASE_URL` is the **origin** — Playwright drops a base-URL path
 * for an absolute request path, so the wrapper prepends the prefix to the **request** `path` while the
 * schema/coverage lookup uses the unprefixed contract path. An endpoint whose contract path is
 * `/v2/sentMail/postMail/` is defined with `path: '/sentMail/postMail/'` (its `/v2` is the prefix's)
 * and `contractPath: '/v2/sentMail/postMail/'`.
 */
// The host's KMail path prefix (prod `/kmail5/v2`, test `/testkmail/v2`) — configurable so pointing
// the bench at a different KMail host is an `.env` change (`KMAIL_PATH_PREFIX`), not a code edit.
const KMAIL_PREFIX = env.KMAIL_PATH_PREFIX;

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
    // Carried through to the registry: coverage invariants require a written reason where an
    // endpoint is excluded from live clearance, and a note that never left the config cannot be read.
    note: config.note,
    tags: ['kmail-api', 'kmail', ...(config.tags ?? [])],
    requirements: config.requirements,
    authentication: config.authentication ?? { required: true },
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
    // Was never wired through here (no KMail DB validation existed to reference it) — added
    // 2026-10-02 alongside the first one, `kmail-mail-persisted`. Mirrors `defineKpostEndpoint`.
    database: config.database,
  };
}

/**
 * A real KMail endpoint the web app calls that the workbook contract does not document — the KMail
 * twin of `defineUndocumentedKpostEndpoint` (same audit-trail rule: `evidence` names the frontend
 * call site). Skips the workbook lookup (which throws for an unknown path); its note starts with
 * "UNDOCUMENTED IN WORKBOOK" so the coverage check can tell it apart.
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
    // No 'undocumented-contract' tag here: endpoint tags become test tags, and that one is not an
    // allowed run-level tag (lint:tags). The note prefix below marks it instead.
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
