import type { EndpointDefinition } from '../../../registry/endpoint-definition';
import { defineKpostEndpoint, type KpostEndpointConfig } from '../kpost-endpoint';

/** A Kall endpoint: `defineKpostEndpoint` with authentication required and the `kall` tag. */
export function defineKallEndpoint(config: KpostEndpointConfig): EndpointDefinition {
  return defineKpostEndpoint({
    ...config,
    authentication: config.authentication ?? { required: true },
    tags: ['kall', ...(config.tags ?? [])],
  });
}
