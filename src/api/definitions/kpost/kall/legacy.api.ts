import { typesOnlySchema } from '@api/schema/sample-schema';
import { body } from '../kpost-endpoint';
import { defineUndocumentedKpostEndpoint } from '../kpost-endpoint';

/**
 * Kall V1 legacy writes (no `/v2` prefix): unused by the frontend but still deployed, and none
 * checks the caller owns the `kallID` or ids it changes. `setKallStatus` and `cancelScheduleKall`
 * share one root cause; `removeMemberKatchupKall` hard-deletes by a raw id list.
 */
export const legacySetKallStatusApi = defineUndocumentedKpostEndpoint({
  id: 'kall-legacy-set-status',
  method: 'POST',
  path: '/kall/setKallStatus',
  summary: "[LEGACY/dead-from-frontend] Set a Kall tracker row's status by raw kallID",
  tags: ['kall', 'kall-legacy', 'needs-id'],
  authentication: { required: true },
  destructive: true,
  sideEffect: 'data',
  request: body(() => ({
    kallID: 0,
    kallStatus: 'cancelled',
    kallEndTime: new Date().toISOString(),
  })),
  requestSchema: typesOnlySchema({
    kallID: 0,
    kallStatus: 'cancelled',
    kallEndTime: new Date().toISOString(),
  }),
  evidence:
    'KallController.setKallStatus (KallController.java:129) — confirmed zero frontend callers; no ' +
    'HttpServletRequest param at all; KallDaoImpl.setKallStatus (line ~117) updates by raw kallID ' +
    'with no sender/receiver ownership check',
});

export const legacyCancelScheduleKallApi = defineUndocumentedKpostEndpoint({
  id: 'kall-legacy-cancel-schedule',
  method: 'POST',
  path: '/kall/cancelScheduleKall',
  summary:
    '[LEGACY/dead-from-frontend] Cancel a scheduled Kall by raw kallID (same fault as setKallStatus, different route)',
  tags: ['kall', 'kall-legacy', 'needs-id'],
  authentication: { required: true },
  destructive: true,
  sideEffect: 'data',
  request: body(() => ({
    kallID: 0,
    kallStatus: 'cancelled',
    kallEndTime: new Date().toISOString(),
  })),
  requestSchema: typesOnlySchema({
    kallID: 0,
    kallStatus: 'cancelled',
    kallEndTime: new Date().toISOString(),
  }),
  evidence:
    'KallController.cancelScheduleKall (KallController.java:391) calls the identical ' +
    'kallService.setKallStatus(kallTracker) that kall-legacy-set-status calls — same unscoped ' +
    'UPDATE, same missing ownership check, reached via a second route name',
});

export const legacyRemoveMemberKatchupKallApi = defineUndocumentedKpostEndpoint({
  id: 'kall-legacy-remove-member',
  method: 'POST',
  path: '/kall/removeMemberKatchupKall',
  summary: '[LEGACY/dead-from-frontend] Bulk hard-delete Kall schedule rows by raw id list',
  tags: ['kall', 'kall-legacy', 'needs-id'],
  authentication: { required: true },
  destructive: true,
  sideEffect: 'data',
  request: body(() => ({ idsList: [] as number[] })),
  requestSchema: typesOnlySchema({ idsList: [] as number[] }),
  evidence:
    'KallController.removeMemberKatchupKall (KallController.java:341) — confirmed zero frontend ' +
    'callers; no HttpServletRequest param at all; KallDaoImpl.removeMemberKatchupKall (line ~363) ' +
    'runs a bare "delete KallScheduleDetails where id in (:idValue)" with no ownership predicate ' +
    'at any layer',
});

export const kallLegacyApis = [
  legacySetKallStatusApi,
  legacyCancelScheduleKallApi,
  legacyRemoveMemberKatchupKallApi,
];
