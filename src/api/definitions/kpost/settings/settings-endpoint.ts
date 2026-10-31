import type { EndpointDefinition } from '../../../registry/endpoint-definition';
import { defineKpostEndpoint, type KpostEndpointConfig } from '../kpost-endpoint';

/**
 * A Settings endpoint: `defineKpostEndpoint` with authentication required and the `settings` tag.
 * The engine signs in as qatest5 (the bench's write target), not qatest1: the write fuzzer's probes
 * are stored as the caller's settings, and on 2026-10-30 they left qatest1's layout theme and font
 * as "javascript:alert(1)", which every later browser session of qatest1 loaded.
 */
export function defineSettingsEndpoint(config: KpostEndpointConfig): EndpointDefinition {
  return defineKpostEndpoint({
    ...config,
    authentication: config.authentication ?? { required: true, principalKey: 'personal-5' },
    tags: ['settings', ...(config.tags ?? [])],
  });
}
