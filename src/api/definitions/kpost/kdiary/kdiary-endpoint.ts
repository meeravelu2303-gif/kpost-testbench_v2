import type { EndpointDefinition } from '../../../registry/endpoint-definition';
import { defineKpostEndpoint, type KpostEndpointConfig } from '../kpost-endpoint';

/**
 * A KDiary endpoint: `defineKpostEndpoint` with authentication required (post-login) and the
 * `kdiary` tag. `/dairySchedule/*` — the caller's own diary schedules, events, participants and
 * reports. The workbook documents no payloads for this module, so shapes are taken from the live
 * client (`components/.../Diary/Diary.js`, `Services/ECommerce.js`) and noted where inferred.
 */
export function defineKdiaryEndpoint(config: KpostEndpointConfig): EndpointDefinition {
  return defineKpostEndpoint({
    ...config,
    authentication: config.authentication ?? { required: true },
    tags: ['kdiary', ...(config.tags ?? [])],
  });
}
