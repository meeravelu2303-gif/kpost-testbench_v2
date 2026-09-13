import type { EndpointDefinition } from '../../../registry/endpoint-definition';
import { defineKpostEndpoint, type KpostEndpointConfig } from '../kpost-endpoint';

/**
 * A Settings endpoint: `defineKpostEndpoint` with authentication required (post-login) and the
 * `settings` tag. `/generalSetting/*` — the caller's own preferences (theme, font, notifications).
 * Payloads from the live client (`Services/ThemeSettings.js`) and the workbook.
 */
export function defineSettingsEndpoint(config: KpostEndpointConfig): EndpointDefinition {
  return defineKpostEndpoint({
    ...config,
    authentication: config.authentication ?? { required: true },
    tags: ['settings', ...(config.tags ?? [])],
  });
}
