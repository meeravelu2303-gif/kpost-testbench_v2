import type { BusinessInvariant } from '../invariant';

const FRD =
  'D:/Kpost Documents/KPOST_FRD_Module3_Kall_v1.0.docx (via docs/business-rules.md § Kall)';

/**
 * Kall — scheduling, rescheduling and the call log.
 *
 * BR-C01 is the rule this repository has the most history with. It was recorded as "confirmed" on
 * the strength of a manual eyeball while the automated test only asserted that the call was
 * ACCEPTED; the owner later reported the real defect (reschedule minting a new kallID). The
 * assertion now checks the response id, and the disagreement between the documented rule and the
 * observed behaviour is carried here and in `CONF-KALL-BR-C01` rather than being resolved.
 */
export const KALL_INVARIANTS: readonly BusinessInvariant[] = [
  {
    invariantId: 'BR-C01',
    module: 'kall',
    statement:
      'Rescheduling a call keeps the SAME call — the same kallID and one dashboard entry — and only moves its status to Rescheduled.',
    provenance: {
      status: 'CONFLICTED',
      citation: `${FRD} → FR-KL-003; CLAUDE.md §2 BR-C01 and §8 2026-09-17`,
      note: 'The rule is documented; the application was reported creating a NEW kallID instead.',
    },
    requirements: ['FR-KL-003', 'FR-KL-004'],
    actors: ['call-caller', 'call-participant'],
    appliesTo: ['kall-reschedule', 'kall-today-kool'],
    preconditions: ['a scheduled call the caller owns'],
    observedStates: ['kall.scheduled', 'kall.rescheduled'],
    expected:
      "the reschedule response's kallID equals the original, the dashboard holds one entry for it, and the sender status moves 6 → 7",
    evidence: ['RESPONSE_FIELD', 'STATE_TRANSITION', 'SIDE_EFFECT'],
    status: 'VERIFIED',
    verifiedBy:
      'tests/api/kpost/kall/feature.spec.ts (records a violation through recordBusinessRuleViolation)',
    conflict:
      'CONF-KALL-BR-C01: the FRD states identity is preserved; the owner reported a new kallID on live. The state catalogue carries the same conflict on `kall.rescheduled`. Not resolved here.',
  },
  {
    invariantId: 'FR-KL-001',
    module: 'kall',
    statement:
      'A scheduled Kall requires a title, a date and a start and end time; a missing field blocks the save.',
    provenance: { status: 'DOCUMENTED', citation: `${FRD} → FR-KL-001` },
    requirements: ['FR-KL-001', 'FR-KL-002'],
    actors: ['call-caller'],
    appliesTo: ['kall-scheduled'],
    preconditions: ['an authenticated caller'],
    expected: 'scheduling with any one required field missing is refused',
    evidence: ['REJECTION'],
    status: 'TO_DO',
  },
  {
    invariantId: 'FR-KL-002',
    module: 'kall',
    statement: 'Participants added to a scheduled call are recorded as invitees of that call.',
    provenance: { status: 'DOCUMENTED', citation: `${FRD} → FR-KL-002` },
    requirements: ['FR-KL-002', 'FR-KL-007'],
    actors: ['call-caller', 'call-participant'],
    appliesTo: ['kall-modify-members', 'kall-today-kool'],
    preconditions: ['a scheduled call and a third account to invite'],
    observedStates: ['kall.participant.status'],
    expected: "the added participant appears in the call's member read-back",
    evidence: ['READ_BACK'],
    status: 'PARTIAL',
    verifiedBy: 'tests/api/kpost/kall/feature.spec.ts',
    gap: 'the add is accepted and asserted; the member read-back is not.',
  },
  {
    invariantId: 'FR-KL-008',
    module: 'kall',
    statement: 'The call log records the participants, their role/team and the call duration.',
    provenance: { status: 'DOCUMENTED', citation: `${FRD} → FR-KL-008; CLAUDE.md §2 Kall` },
    requirements: ['FR-KL-008'],
    actors: ['call-caller', 'call-participant'],
    appliesTo: ['kall-dashboard', 'kall-info'],
    preconditions: ['a completed call'],
    observedStates: ['kall.closed'],
    expected: 'the log entry for the completed call carries participants, role/team and a duration',
    evidence: ['READ_BACK', 'SIDE_EFFECT'],
    status: 'TO_DO',
    gap: 'a call cannot be completed headlessly — `kall.connected` is unreachable without a second WebRTC peer.',
  },
  {
    invariantId: 'FR-KL-009',
    module: 'kall',
    statement: 'The call log records the exact start and end timestamps.',
    provenance: { status: 'DOCUMENTED', citation: `${FRD} → FR-KL-009` },
    requirements: ['FR-KL-009'],
    actors: ['call-caller'],
    appliesTo: ['kall-dashboard'],
    preconditions: ['a completed call'],
    expected: 'the log entry carries a precise start and end timestamp, start before end',
    evidence: ['READ_BACK'],
    status: 'TO_DO',
    gap: 'same blocker as FR-KL-008: no completed call can be produced headlessly.',
  },
];
