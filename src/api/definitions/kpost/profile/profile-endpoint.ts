import type { EndpointDefinition } from '../../../registry/endpoint-definition';
import {
  defineKpostEndpoint,
  defineUndocumentedKpostEndpoint,
  type KpostEndpointConfig,
  type UndocumentedKpostEndpointConfig,
} from '../kpost-endpoint';

/**
 * A Profile endpoint: `defineKpostEndpoint` with authentication required (the whole module is
 * post-login) and the `profile` tag. The Profile module is **not covered by any of the five
 * documents** (BRD/PRD/SRS/FSD/FRD describe only Signup&Login, Katchup, Kall, KMail), so these
 * definitions carry no FR ids and their contracts come from the workbook + the live web client
 * (`KPOST_REACTJS_2023_V1`).
 */
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
