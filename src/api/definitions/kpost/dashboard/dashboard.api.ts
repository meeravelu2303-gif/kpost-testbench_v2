import { body } from '../kpost-endpoint';
import { defineKpostEndpoint, type KpostEndpointConfig } from '../kpost-endpoint';
import type { EndpointDefinition } from '../../../registry/endpoint-definition';

/**
 * The KPost **Dashboard** module — `/v2/dashboard/*`. The Home screen's recent-messages panel:
 * the initial page of dashboard messages and the incremental "only newer than this" fetches.
 *
 * All three are authenticated reads of the caller's own messages, keyed by `serverTime` and message
 * ids (not tenant identifiers), so they run on live. Undocumented (no FR ids); the payloads come
 * from the live web client (`Home.js`, `RecentMessage.js`).
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
  tags: ['dashboard-read'],
  destructive: false,
  productionSafe: true,
  request: body(() => ({ firstMsgID: null, serverTime: null })),
});

export const dashboardApis = [
  homeDashboardMsgsApi,
  katchupDashboardMsgApi,
  homeDashboardNewMsgsApi,
];
