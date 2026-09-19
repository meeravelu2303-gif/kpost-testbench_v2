import { env } from '@config/env';
import { workbookContract } from '../../contract/workbook-contract';
import type { EndpointDefinition } from '../../registry/endpoint-definition';
import type { KpostEndpointConfig } from '../kpost/kpost-endpoint';

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
  };
}
