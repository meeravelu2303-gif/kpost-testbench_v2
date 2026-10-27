import { body } from '../kpost-endpoint';
import { defineKpostEndpoint, type KpostEndpointConfig } from '../kpost-endpoint';
import type { EndpointDefinition } from '../../../registry/endpoint-definition';

/**
 * Dashboard (`/v2/dashboard/*`): the Home recent-messages panel, reads of the caller's own
 * messages.
 */
function defineDashboardEndpoint(config: KpostEndpointConfig): EndpointDefinition {
  return defineKpostEndpoint({
    ...config,
    authentication: config.authentication ?? { required: true },
    tags: ['dashboard', ...(config.tags ?? [])],
  });
}

export const homeDashboardMsgsApi = defineDashboardEndpoint({
  id: 'dashboard-home-msgs',
  method: 'POST',
  path: '/v2/dashboard/homeDashboardMsgs/',
  summary: 'The Home dashboard message list (initial page)',
  tags: ['dashboard-read'],
  // Reads our own recent messages; nulls fetch the latest page, as the client sends on first load.
  destructive: false,
  productionSafe: true,
  request: body(() => ({ serverTime: null, lastMsgID: null })),
});

export const katchupDashboardMsgApi = defineDashboardEndpoint({
  id: 'dashboard-katchup-msg',
  method: 'POST',
  path: '/v2/dashboard/katchupDashboardMsg/',
  summary: 'The Katchup dashboard message summary',
  tags: ['dashboard-read'],
  destructive: false,
  productionSafe: true,
  request: body(() => ({ serverTime: null })),
});

export const homeDashboardNewMsgsApi = defineDashboardEndpoint({
  id: 'dashboard-home-new-msgs',
  method: 'POST',
  path: '/v2/dashboard/homeDashboardNewMsgs',
  summary: 'Only the dashboard messages newer than a marker (incremental refresh)',
  tags: ['dashboard-read', 'needs-id'],
  // Needs a real `firstMsgID` and `serverTime` from a prior read (nulls 500), so it is not run
  // standalone.
  destructive: false,
  request: body(() => ({ firstMsgID: null, serverTime: null })),
  note: 'incremental fetch needs a real firstMsgID + ISO serverTime from a prior homeDashboardMsgs read; null markers 500 the backend (not a standalone read)',
});

export const dashboardApis = [
  homeDashboardMsgsApi,
  katchupDashboardMsgApi,
  homeDashboardNewMsgsApi,
];
