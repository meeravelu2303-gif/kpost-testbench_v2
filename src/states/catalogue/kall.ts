import type { Observation } from '../observation';
import type { StateTransition } from '../transition';
import type { StateDefinition, StateVocabulary } from '../vocabulary';

/**
 * Kall — documented state, transitions and observation points.
 *
 * Kall is the only KPOST resource whose documentation contains an explicit from→to sequence
 * (`docs/kall-flow.md`), which makes it the best-evidenced transition model in the repository.
 *
 * ## The representation problem, not normalised
 *
 * The workbook documents `todayKoolKall` TWICE, with incompatible response shapes:
 *
 *   retired row (usable: false)   kallStatus: "Scheduled"   kallScheduleDetails[].{kallAcceptStatus, joinedStatus}
 *   current row (usable: true)    senderKallStatus: 6       kallDetails[].{receiverKallStatus, joinStatus, deleteStatus}
 *
 * A string label under one field name, a numeric code under another, for one endpoint. The states
 * below are defined on the **current** row's fields because that is what a live call would return and
 * what the repository's one live observation recorded — but the alternative is NOT discarded: it is
 * preserved in full as `CONF-KALL-STATUS-REPRESENTATION`, and that conflict is not resolved here.
 */

const TYPES_CONTRACT = 'contracts/kpost-types.json → kallStatus';
const FLOW_DOC = 'docs/kall-flow.md §"kallStatus (sender & receiver)"';
const CURRENT_SAMPLE =
  'contracts/kpost-api.contract.json → GET /v2/kall/todayKoolKall/ response example (the usable: true row)';

/** The nine codes with a documented meaning and at least one documented transition. */
const lifecycle = (
  slug: string,
  term: string,
  code: string,
  meaning: string,
  note?: string,
): StateDefinition => ({
  stateId: `kall.${slug}`,
  resource: 'kall',
  term,
  rawValue: code,
  field: 'senderKallStatus',
  representation: 'NUMERIC_CODE',
  role: 'LIFECYCLE',
  scope: 'RESOURCE',
  meaning,
  provenance: {
    status: 'DOCUMENTED',
    citation: `${TYPES_CONTRACT}."${code}"; ${FLOW_DOC}`,
    ...(note ? { note } : {}),
  },
});

export const KALL_VOCABULARY: StateVocabulary = {
  resource: 'kall',
  module: 'kall',
  describe:
    'The lifecycle of a call — both the direct-call progression and the scheduled-call branch — plus ' +
    'the per-participant state each invitee carries.',
  provenance: { status: 'DOCUMENTED', citation: `${TYPES_CONTRACT}; ${FLOW_DOC}` },
  identity: {
    field: 'kallID',
    provenance: {
      status: 'DOCUMENTED',
      citation: `${CURRENT_SAMPLE} — every call row carries kallID`,
    },
  },
  states: [
    lifecycle('new', 'new', '0', 'A call has been placed and is ringing.'),
    lifecycle(
      'connected',
      'connected',
      '1',
      'The call was answered and is in progress.',
      'Unreachable by this bench: a call cannot connect headlessly, as there is no second WebRTC ' +
        'peer (docs/kall-flow.md).',
    ),
    lifecycle('cancelled', 'cancelled', '2', 'The caller ended the call before it was answered.'),
    lifecycle('noresponse', 'noresponse', '3', 'The call was not answered.'),
    lifecycle('declined', 'declined', '4', 'The recipient declined the call.'),
    lifecycle('busy', 'busy', '5', 'The recipient was busy.'),
    lifecycle('scheduled', 'Scheduled', '6', 'A call has been scheduled for a future time.'),
    lifecycle(
      'rescheduled',
      'ReScheduled',
      '7',
      'A scheduled call has been moved, keeping its identity (the same kallID).',
      'Whether the application actually reaches this state is DISPUTED — see CONF-KALL-BR-C01.',
    ),
    lifecycle('closed', 'closed', '8', 'The call has ended.'),
    // The three codes with no documented transition, no actor and no stated cause.
    {
      stateId: 'kall.removed',
      resource: 'kall',
      term: 'removed',
      rawValue: '9',
      field: 'senderKallStatus',
      representation: 'NUMERIC_CODE',
      role: 'UNKNOWN',
      scope: 'RESOURCE',
      meaning: 'Not stated by any source.',
      provenance: {
        status: 'UNKNOWN',
        citation: `${TYPES_CONTRACT}."9"`,
        note: 'The label exists in the enum. No flow, actor, cause or transition is documented.',
      },
    },
    {
      stateId: 'kall.koolkall-accepted',
      resource: 'kall',
      term: 'KoolKall Accepted',
      rawValue: '10',
      field: 'senderKallStatus',
      representation: 'NUMERIC_CODE',
      role: 'UNKNOWN',
      scope: 'RESOURCE',
      meaning: 'Not stated by any source.',
      provenance: {
        status: 'UNKNOWN',
        citation: `${TYPES_CONTRACT}."10"`,
        note:
          'Plausibly relates to the per-participant kallAcceptStatus, but no source says so and ' +
          'assuming it would be invention.',
      },
    },
    {
      stateId: 'kall.not-joined',
      resource: 'kall',
      term: 'Not Joined',
      rawValue: '11',
      field: 'senderKallStatus',
      representation: 'NUMERIC_CODE',
      role: 'UNKNOWN',
      scope: 'RESOURCE',
      meaning: 'Not stated by any source.',
      provenance: { status: 'UNKNOWN', citation: `${TYPES_CONTRACT}."11"` },
    },
    {
      stateId: 'kall.deleted-by-sender',
      resource: 'kall',
      term: 'deletedBySender',
      rawValue: 'true | false',
      field: 'deletedBySender',
      representation: 'BOOLEAN_FLAG',
      role: 'MARKER',
      scope: 'RESOURCE',
      meaning: 'The caller has cleared this call from their own log.',
      provenance: {
        status: 'OBSERVED',
        citation:
          'CLAUDE.md §8 2026-09-13 Kall entry ("every test call shows deletedBySender: true")',
        note:
          'OBSERVED means a human recorded it in a decision log after a live run. No automated ' +
          'assertion reads this field.',
      },
    },
    // ---- per participant -----------------------------------------------------------------------
    {
      stateId: 'kall.participant.status',
      resource: 'kall',
      term: 'receiverKallStatus',
      rawValue: '<kallStatus code>',
      field: 'receiverKallStatus',
      representation: 'NUMERIC_CODE',
      role: 'LIFECYCLE',
      scope: 'PER_PARTICIPANT',
      meaning: "One participant's own status for the call, drawn from the same kallStatus codes.",
      provenance: {
        status: 'DOCUMENTED',
        citation: CURRENT_SAMPLE,
        note:
          'Sample values seen: 0, 1, 6, 8. Zero references in src/ or tests/. Whether a participant ' +
          'code may differ from the sender code, and what that would mean, is not documented.',
      },
    },
    {
      stateId: 'kall.participant.joined',
      resource: 'kall',
      term: 'joinStatus',
      rawValue: 'true | false',
      field: 'joinStatus',
      representation: 'BOOLEAN_FLAG',
      role: 'LIFECYCLE',
      scope: 'PER_PARTICIPANT',
      meaning: 'Whether this participant has joined the call.',
      provenance: {
        status: 'DOCUMENTED',
        citation: CURRENT_SAMPLE,
        note:
          'The retired workbook row spells the same idea `joinedStatus` with "Y"/"N" instead of a ' +
          'boolean. See CONF-KALL-STATUS-REPRESENTATION.',
      },
    },
    {
      stateId: 'kall.participant.deleted',
      resource: 'kall',
      term: 'deleteStatus',
      rawValue: 'true | false',
      field: 'deleteStatus',
      representation: 'BOOLEAN_FLAG',
      role: 'MARKER',
      scope: 'PER_PARTICIPANT',
      meaning: 'Whether this participant has cleared the call from their own log.',
      provenance: { status: 'DOCUMENTED', citation: CURRENT_SAMPLE },
    },
  ],
};

export const KALL_TRANSITIONS: readonly StateTransition[] = [
  {
    transitionId: 'kall.initiate',
    resource: 'kall',
    from: null,
    action: 'kall.initiate',
    to: 'kall.new',
    actor: 'call-caller',
    requirementIds: ['FR-KL-001'],
    mechanism: 'API',
    endpointId: 'kall-initiate',
    provenance: {
      status: 'DOCUMENTED',
      citation: 'docs/kall-flow.md (direct-call sequence, initiateKall)',
    },
  },
  {
    transitionId: 'kall.connect',
    resource: 'kall',
    from: 'kall.new',
    action: 'kall.update-status',
    to: 'kall.connected',
    // No actor: the documented sequence does not say which party drives the status update, and the
    // endpoint exists in both a caller-scoped and a sender-and-receiver form.
    requirementIds: [],
    mechanism: 'API',
    endpointId: 'kall-update-status',
    provenance: {
      status: 'DOCUMENTED',
      citation: 'docs/kall-flow.md ("0 new → 1 connected → 8 closed")',
      note: 'The bench never sends this value; only `cancelled` (2) is ever sent.',
    },
  },
  {
    transitionId: 'kall.cancel',
    resource: 'kall',
    from: 'kall.new',
    action: 'kall.update-status',
    to: 'kall.cancelled',
    actor: 'call-caller',
    requirementIds: [],
    mechanism: 'API',
    endpointId: 'kall-update-status',
    provenance: {
      status: 'DOCUMENTED',
      citation: 'docs/kall-flow.md ("→ 2 cancelled / 3 noresponse / 4 declined / 5 busy")',
    },
  },
  {
    transitionId: 'kall.decline',
    resource: 'kall',
    from: 'kall.new',
    action: 'kall.update-status',
    to: 'kall.declined',
    actor: 'call-participant',
    requirementIds: [],
    mechanism: 'API',
    endpointId: 'kall-update-status',
    provenance: { status: 'DOCUMENTED', citation: 'docs/kall-flow.md (terminal outcomes)' },
  },
  {
    transitionId: 'kall.end',
    resource: 'kall',
    from: 'kall.connected',
    action: 'kall.end-individual',
    to: 'kall.closed',
    actor: 'call-caller',
    requirementIds: [],
    mechanism: 'API',
    endpointId: 'kall-end-individual',
    provenance: { status: 'DOCUMENTED', citation: 'docs/kall-flow.md (endIndividualKall)' },
  },
  {
    transitionId: 'kall.schedule',
    resource: 'kall',
    from: null,
    action: 'kall.schedule',
    to: 'kall.scheduled',
    actor: 'call-caller',
    requirementIds: ['FR-KL-003'],
    mechanism: 'API',
    endpointId: 'kall-scheduled',
    provenance: { status: 'DOCUMENTED', citation: 'docs/kall-flow.md (scheduled branch)' },
  },
  {
    transitionId: 'kall.reschedule',
    resource: 'kall',
    from: 'kall.scheduled',
    action: 'kall.reschedule',
    to: 'kall.rescheduled',
    actor: 'call-caller',
    requirementIds: ['FR-KL-004'],
    mechanism: 'API',
    endpointId: 'kall-reschedule',
    provenance: {
      status: 'CONFLICTED',
      citation:
        'docs/kall-flow.md (BR-C01: "status 6 Scheduled → 7 ReScheduled, the entry keeps its kallID")',
      note:
        'The transition is documented; whether the current build performs it is DISPUTED. Three ' +
        'sources report it observed on live, while the test that checks it records the opposite. ' +
        'See CONF-KALL-BR-C01. The identity half of BR-C01 (the kallID must not change) is an ' +
        'invariant about the transition, not a state, and is not modelled here.',
    },
  },
  {
    transitionId: 'kall.clear-history',
    resource: 'kall',
    from: 'kall.closed',
    action: 'kall.clear-history',
    to: 'kall.deleted-by-sender',
    actor: 'call-caller',
    requirementIds: [],
    mechanism: 'API',
    endpointId: 'kall-clear-history',
    provenance: {
      status: 'OBSERVED',
      citation: 'CLAUDE.md §8 2026-09-13 Kall entry (cleanup verified: deletedBySender: true)',
    },
  },
];

export const KALL_OBSERVATIONS: readonly Observation[] = [
  {
    observationId: 'kall.status-via-today-kool',
    resource: 'kall',
    observes: [
      'kall.new',
      'kall.scheduled',
      'kall.rescheduled',
      'kall.closed',
      'kall.deleted-by-sender',
    ],
    endpointId: 'kall-today-kool',
    fieldPath: 'data[].senderKallStatus',
    runsOnLive: true,
    provenance: { status: 'DOCUMENTED', citation: CURRENT_SAMPLE },
    note:
      'Runs on the default live pass and is read by no test. The one live status observation the ' +
      'repository records (CLAUDE.md, senderKallStatus: 7) was a MANUAL inspection of this row.',
  },
  {
    observationId: 'kall.participant-state-via-today-kool',
    resource: 'kall',
    observes: ['kall.participant.status', 'kall.participant.joined', 'kall.participant.deleted'],
    endpointId: 'kall-today-kool',
    fieldPath: 'data[].kallDetails[].{receiverKallStatus,joinStatus,deleteStatus}',
    runsOnLive: true,
    provenance: { status: 'DOCUMENTED', citation: CURRENT_SAMPLE },
    note: 'Zero references to any of these fields exist in src/ or tests/.',
  },
  {
    observationId: 'kall.status-via-kall-info',
    resource: 'kall',
    observes: ['kall.new', 'kall.closed', 'kall.deleted-by-sender'],
    endpointId: 'kall-info',
    fieldPath: 'data[].senderKallStatus',
    runsOnLive: true,
    provenance: {
      status: 'DOCUMENTED',
      citation: 'contracts/kpost-api.contract.json → POST /v2/kall/kallInfo response example',
    },
  },
  {
    observationId: 'kall.status-via-reschedule-response',
    resource: 'kall',
    observes: ['kall.rescheduled'],
    endpointId: 'kall-reschedule',
    fieldPath: 'data[].senderKallStatus',
    runsOnLive: false,
    provenance: {
      status: 'DOCUMENTED',
      citation: 'contracts/kpost-api.contract.json → POST /v2/kall/reScheduleKall response example',
    },
    note:
      'This is the one field path the bench already reads: tests/api/kpost/kall/feature.spec.ts:225 ' +
      'reads data[0].senderKallStatus. The read is guarded by an undefined-check, so it asserts ' +
      'nothing when the field is absent.',
  },
];
