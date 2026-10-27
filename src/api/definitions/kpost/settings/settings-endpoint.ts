import type { EndpointDefinition } from '../../../registry/endpoint-definition';
import { defineKpostEndpoint, type KpostEndpointConfig } from '../kpost-endpoint';

/**
 * A Settings endpoint: `defineKpostEndpoint` with authentication required and the `settings` tag.
 */
export function defineSettingsEndpoint(config: KpostEndpointConfig): EndpointDefinition {
  return defineKpostEndpoint({
    ...config,
    authentication: config.authentication ?? { required: true },
    tags: ['settings', ...(config.tags ?? [])],
  });
}
