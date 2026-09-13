import type { EndpointDefinition } from '../../../registry/endpoint-definition';
import { defineKpostEndpoint, type KpostEndpointConfig } from '../kpost-endpoint';

/**
 * A Katchup endpoint. Same as `defineKpostEndpoint`, with the two module defaults applied:
 *
 *  - **authentication is required.** Every Katchup route needs a token — it is all post-login. The
 *    base factory defaults to *public* (it was written for the common module), so forgetting this
 *    would test the auth-probes against the wrong expectation.
 *  - the `katchup` tag, so the whole module is one filter and bugs route to the Katchup component.
 *
 * The message-type/status/share-type codes come from `@api/schemas/kpost-types`
 * (`KATCHUP_MESSAGE_TYPE`, `KATCHUP_STATUS`, `KATCHUP_SHARE_TYPE`) — never a literal, so a workbook
 * edit that renumbers them cannot silently change what a payload means. See `docs/katchup-flow.md`.
 */
export function defineKatchupEndpoint(config: KpostEndpointConfig): EndpointDefinition {
  return defineKpostEndpoint({
    ...config,
    authentication: config.authentication ?? { required: true },
    tags: ['katchup', ...(config.tags ?? [])],
  });
}
