import type { EndpointDefinition } from '../../../registry/endpoint-definition';
import {
  defineKpostEndpoint,
  defineUndocumentedKpostEndpoint,
  type KpostEndpointConfig,
  type UndocumentedKpostEndpointConfig,
} from '../kpost-endpoint';

/** A Profile endpoint: `defineKpostEndpoint` with authentication required and the `profile` tag. */
export function defineProfileEndpoint(config: KpostEndpointConfig): EndpointDefinition {
  return defineKpostEndpoint({
    ...config,
    authentication: config.authentication ?? { required: true },
    tags: ['profile', ...(config.tags ?? [])],
  });
}

/** Same as `defineProfileEndpoint`, for a real endpoint the workbook does not document. */
export function defineUndocumentedProfileEndpoint(
  config: UndocumentedKpostEndpointConfig,
): EndpointDefinition {
  return defineUndocumentedKpostEndpoint({
    ...config,
    authentication: config.authentication ?? { required: true },
    tags: ['profile', ...(config.tags ?? [])],
  });
}
