import { typesOnlySchema } from '@api/schema/sample-schema';
import { body, defineUndocumentedKpostEndpoint } from '../kpost-endpoint';
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

export const dashboardKallHistoryApi = defineUndocumentedKpostEndpoint({
  id: 'dashboard-kall-history',
  authentication: { required: true },
  method: 'POST',
  path: '/v2/dashboard/kallDashboard',
  summary:
    'The caller’s call history from the dashboard service (older twin of /v2/kall/kallDashboard)',
  tags: ['dashboard', 'dashboard-read', 'kall'],
  destructive: false,
  // Reads only our own calls up to "now"; the workbook row is retired as superseded.
  productionSafe: true,
  request: body(() => ({ serverTime: Date.now() })),
  requestSchema: typesOnlySchema({ serverTime: 0 }),
  evidence:
    'DashboardControllerV2.java:97 kallDashboard (receiver = token kpostID; kallStartTime <= serverTime); ' +
    'workbook KatchupAPI row 23 /v2/dashboard/kallDashboard/ marked superseded; no client calls this path',
  note: 'reads the legacy TBL_KPOST_KALL_TRACKERS, so it may stay empty for calls made through KallControllerV3',
});

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
  dashboardKallHistoryApi,
  homeDashboardMsgsApi,
  katchupDashboardMsgApi,
  homeDashboardNewMsgsApi,
];
