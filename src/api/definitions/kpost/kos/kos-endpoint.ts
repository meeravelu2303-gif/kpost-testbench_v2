import type { EndpointDefinition } from '../../../registry/endpoint-definition';
import {
  defineKpostEndpoint,
  defineUndocumentedKpostEndpoint,
  type KpostEndpointConfig,
  type UndocumentedKpostEndpointConfig,
} from '../kpost-endpoint';

/** A KOS endpoint: `defineKpostEndpoint` with authentication required and the `kos` tag. */
export function defineKosEndpoint(config: KpostEndpointConfig): EndpointDefinition {
  return defineKpostEndpoint({
    ...config,
    authentication: config.authentication ?? { required: true },
    tags: ['kos', ...(config.tags ?? [])],
  });
}

/** Same as `defineKosEndpoint`, for a real endpoint the workbook does not document. */
export function defineUndocumentedKosEndpoint(
  config: UndocumentedKpostEndpointConfig,
): EndpointDefinition {
  return defineUndocumentedKpostEndpoint({
    ...config,
    authentication: config.authentication ?? { required: true },
    tags: ['kos', ...(config.tags ?? [])],
  });
}
