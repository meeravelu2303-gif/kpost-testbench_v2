import type { EndpointDefinition } from '../../../registry/endpoint-definition';
import { defineKpostEndpoint, type KpostEndpointConfig } from '../kpost-endpoint';

/** A Katchup endpoint: `defineKpostEndpoint` with authentication required and the `katchup` tag. */
export function defineKatchupEndpoint(config: KpostEndpointConfig): EndpointDefinition {
  return defineKpostEndpoint({
    ...config,
    authentication: config.authentication ?? { required: true },
    tags: ['katchup', ...(config.tags ?? [])],
  });
}
