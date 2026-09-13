import { workbookContract } from '../../contract/workbook-contract';
import type { EndpointDefinition } from '../../registry/endpoint-definition';
import type { KpostEndpointConfig } from '../kpost/kpost-endpoint';

/**
 * A **KMail** endpoint. KMail is its own suite (`kmail-api`) on its own host
 * (`KMAIL_API_BASE_URL=https://kmail5.kpostindia.com/kmail5/v2`, confirmed by probe — real routes
 * answer 401/405, unknown ones 404). The schemas come from the `kmail-api` contract; the response
 * envelope is KMail's own (`RESPONSE_CONTRACTS.kmail`), and the whole module is post-login.
 *
 * The host serves KMail under a `/kmail5/v2` prefix. `KMAIL_API_BASE_URL` is the **origin**
 * (`https://kmail5.kpostindia.com`) — a base URL with a path is dropped by Playwright when the
 * request path starts with `/` — so the wrapper prepends the prefix to the **request** `path` while
 * the schema/coverage lookup uses the unprefixed contract path. An endpoint whose contract path is
 * `/v2/sentMail/postMail/` is defined with `path: '/sentMail/postMail/'` (its `/v2` is the prefix's)
 * and `contractPath: '/v2/sentMail/postMail/'`.
 */
const KMAIL_PREFIX = '/kmail5/v2';

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
