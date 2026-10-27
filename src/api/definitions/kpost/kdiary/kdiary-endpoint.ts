import type { EndpointDefinition } from '../../../registry/endpoint-definition';
import { defineKpostEndpoint, type KpostEndpointConfig } from '../kpost-endpoint';

/**
 * A KDiary endpoint: authentication required and the `kdiary` tag. Payloads come from the live
 * client.
 */
export function defineKdiaryEndpoint(config: KpostEndpointConfig): EndpointDefinition {
  return defineKpostEndpoint({
    ...config,
    authentication: config.authentication ?? { required: true },
    tags: ['kdiary', ...(config.tags ?? [])],
  });
}
