import type { EndpointDefinition } from '../../../registry/endpoint-definition';
import { defineKpostEndpoint, type KpostEndpointConfig } from '../kpost-endpoint';

/**
 * A Contacts endpoint: `defineKpostEndpoint` with authentication required and the `contacts` tag.
 */
export function defineContactsEndpoint(config: KpostEndpointConfig): EndpointDefinition {
  return defineKpostEndpoint({
    ...config,
    authentication: config.authentication ?? { required: true },
    tags: ['contacts', ...(config.tags ?? [])],
  });
}
