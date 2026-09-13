import type { EndpointDefinition } from '../../../registry/endpoint-definition';
import { defineKpostEndpoint, type KpostEndpointConfig } from '../kpost-endpoint';

/**
 * A KOS endpoint: `defineKpostEndpoint` with authentication required (post-login) and the `kos` tag.
 * KOS is the office suite — KWord documents (`/kword/*`) and K-AI (`/ai/*`). The KOS screen renders
 * "Coming Soon" today, so this module is API-only. Payloads from the live client (`Services/KOS.js`,
 * `KAI.js`) and the workbook; the AI generation endpoints call a real (metered) AI service.
 */
export function defineKosEndpoint(config: KpostEndpointConfig): EndpointDefinition {
  return defineKpostEndpoint({
    ...config,
    authentication: config.authentication ?? { required: true },
    tags: ['kos', ...(config.tags ?? [])],
  });
}
