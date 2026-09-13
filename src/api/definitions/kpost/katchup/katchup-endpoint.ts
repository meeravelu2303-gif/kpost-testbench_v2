import type { EndpointDefinition } from '../../../registry/endpoint-definition';
import { defineKpostEndpoint, type KpostEndpointConfig } from '../kpost-endpoint';

/**
 * A Katchup endpoint: `defineKpostEndpoint` with authentication required (the whole module is
 * post-login; the base factory defaults to public) and the `katchup` tag. Codes come from
 * `@api/schemas/kpost-types`; the flow is analysed in `docs/katchup-flow.md`.
 */
export function defineKatchupEndpoint(config: KpostEndpointConfig): EndpointDefinition {
  return defineKpostEndpoint({
    ...config,
    authentication: config.authentication ?? { required: true },
    tags: ['katchup', ...(config.tags ?? [])],
  });
}
