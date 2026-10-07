import { body } from '../kpost-endpoint';
import { defineUndocumentedKpostEndpoint } from '../kpost-endpoint';

/**
 * Kall **V1 legacy writes** — `KallController.java` (`@RequestMapping("kall")`, no `/v2` prefix,
 * confirmed dead from the real frontend the same way as Katchup's V1 controller: `EndPointURL`
 * already bakes in `/v2`, so every live call resolves to the V3 controller at `/v2/kall/*`, never
 * these bare paths). Still deployed and directly callable. Confirmed 2026-10-06/07 from source:
 * none of the three methods below take an `HttpServletRequest` parameter at all, so none of them can
 * override an identity from the JWT even in principle — unlike their `/v2/kall/*` siblings, which
 * correctly call `kallTracker.setSender((String) request.getAttribute("kpostID"))` first.
 *
 * `setKallStatus` and `cancelScheduleKall` are the SAME root cause under two route names:
 * `KallController.cancelScheduleKall` calls `kallService.setKallStatus(kallTracker)` — the identical
 * service method `setKallStatus` calls — which reaches `KallDaoImpl.setKallStatus` (line ~117):
 * `UPDATE TBL_KPOST_KALL_TRACKERS kall set kall_status=:kallStatus, kall_end_time=:kallEndTime where
 * kall_id = :kallID` — a bare UPDATE by a client-supplied `kallID`, no sender/receiver ownership
 * check anywhere in the call chain. One fix (checking the token's own kpostID against the kall
 * row's sender/receiver before the UPDATE) closes both routes.
 *
 * `removeMemberKatchupKall` is a separate, more severe fault: `KallDaoImpl.removeMemberKatchupKall`
 * (line ~363) runs `delete KallScheduleDetails where id in (:idValue)` — a bulk, permanent HARD
 * DELETE by a raw client-supplied id list, with zero ownership predicate at any layer.
 */
export const legacySetKallStatusApi = defineUndocumentedKpostEndpoint({
  id: 'kall-legacy-set-status',
  method: 'POST',
  path: '/kall/setKallStatus',
  summary: '[LEGACY/dead-from-frontend] Set a Kall tracker row\'s status by raw kallID',
  tags: ['kall', 'kall-legacy', 'needs-id'],
  authentication: { required: true },
  destructive: true,
  sideEffect: 'data',
  request: body(() => ({ kallID: 0, kallStatus: 'cancelled', kallEndTime: new Date().toISOString() })),
  evidence:
    'KallController.setKallStatus (KallController.java:129) — confirmed zero frontend callers; no ' +
    'HttpServletRequest param at all; KallDaoImpl.setKallStatus (line ~117) updates by raw kallID ' +
    'with no sender/receiver ownership check',
});

export const legacyCancelScheduleKallApi = defineUndocumentedKpostEndpoint({
  id: 'kall-legacy-cancel-schedule',
  method: 'POST',
  path: '/kall/cancelScheduleKall',
  summary: '[LEGACY/dead-from-frontend] Cancel a scheduled Kall by raw kallID (same fault as setKallStatus, different route)',
  tags: ['kall', 'kall-legacy', 'needs-id'],
  authentication: { required: true },
  destructive: true,
  sideEffect: 'data',
  request: body(() => ({ kallID: 0, kallStatus: 'cancelled', kallEndTime: new Date().toISOString() })),
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
