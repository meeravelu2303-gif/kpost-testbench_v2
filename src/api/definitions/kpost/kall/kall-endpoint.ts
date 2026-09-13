import type { EndpointDefinition } from '../../../registry/endpoint-definition';
import { defineKpostEndpoint, type KpostEndpointConfig } from '../kpost-endpoint';

/**
 * A Kall endpoint: `defineKpostEndpoint` with authentication required (the whole module is
 * post-login; the base factory defaults to public) and the `kall` tag. The status / type / mode /
 * repeat-type codes come from `@api/schemas/kpost-types`; the flow is analysed in
 * `docs/kall-flow.md`.
 */
export function defineKallEndpoint(config: KpostEndpointConfig): EndpointDefinition {
  return defineKpostEndpoint({
    ...config,
    authentication: config.authentication ?? { required: true },
    tags: ['kall', ...(config.tags ?? [])],
  });
}
