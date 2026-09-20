import { env } from '@config/env';
import type { EndpointDefinition } from '../../registry/endpoint-definition';
import { buildDefinition } from '../endpoint-factory';
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
  return buildDefinition(config, {
    suite: 'kmail-api',
    responseContract: 'kmail',
    suiteTags: ['kmail-api', 'kmail'],
    defaultAuthentication: { required: true },
    // The request goes to the prefixed path; schema lookup/coverage keep the unprefixed contract path.
    pathPrefix: KMAIL_PREFIX,
  });
}
