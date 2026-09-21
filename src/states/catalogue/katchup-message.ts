import type { Observation } from '../observation';
import type { StateTransition } from '../transition';
import type { StateVocabulary } from '../vocabulary';

/**
 * Katchup message — documented state, transitions and observation points.
 *
 * ## The two things this file is careful about
 *
 * **1. `katchupStatus` is not one enum.** Codes 0–3 describe a message's delivery/read lifecycle;
 * code 4 ("Group") describes what KIND of row it is, and the bench sends it as a routing value
 * (`status: KATCHUP_STATUS.group` in `tests/api/kpost/katchup/feature.spec.ts:291`). They are
 * recorded with different `role`s so nothing can conclude that a group message is capable of being
 * `Read` through this field. See `CONF-KATCHUP-STATUS-OVERLOADED`.
 *
 * **2. The read transition and the read observation are separate problems.** There is no endpoint
 * that marks a 1:1 message read — the web client does it as a side effect of opening the thread — so
 * the transition's mechanism is `UI`. But the resulting state IS returned, per message, by the 1:1
 * conversation read, which runs on the default live pass. Recording those as one fact (as "read
 * receipts are unverifiable") would have been wrong in both directions.
 */

const TYPES_CONTRACT = 'contracts/kpost-types.json → katchupStatus';
const CONVERSATION_SAMPLE =
  'contracts/kpost-api.contract.json → POST /v2/katchup/katchupMessagesForSelectedContactID/ response example';
const GROUP_RECEIPT_SAMPLE =
  'contracts/kpost-api.contract.json → POST /v2/katchup/getReadStatusGroupMessage/ response example';

export const KATCHUP_MESSAGE_VOCABULARY: StateVocabulary = {
  resource: 'katchup.message',
  module: 'katchup',
  describe:
    'The delivery/read lifecycle of a Katchup message, plus the independent markers the same row ' +
    'carries. The lifecycle codes come from the workbook Types tab; the markers come from the ' +
    'documented conversation-read response.',
  provenance: {
    status: 'DOCUMENTED',
    citation: `${TYPES_CONTRACT}; docs/katchup-flow.md §"status — delivery state of a message row"`,
  },
  identity: {
    field: 'msgID',
    provenance: {
      status: 'DOCUMENTED',
      citation: `${CONVERSATION_SAMPLE} — every message row carries msgID`,
    },
  },
  states: [
    {
      stateId: 'katchup.message.sent',
      resource: 'katchup.message',
      term: 'Sent',
      rawValue: '0',
      field: 'status',
      representation: 'NUMERIC_CODE',
      role: 'LIFECYCLE',
      scope: 'RESOURCE',
      meaning: 'The message has been sent. The client sets this on every new send.',
      provenance: {
        status: 'DOCUMENTED',
        citation: `${TYPES_CONTRACT}."0"; src/api/definitions/kpost/katchup/send.api.ts:34`,
        note: 'Appears in the documented conversation sample alongside readTime: null.',
      },
    },
    {
      stateId: 'katchup.message.unread',
      resource: 'katchup.message',
      term: 'Unread',
      rawValue: '1',
      field: 'status',
      representation: 'NUMERIC_CODE',
      role: 'LIFECYCLE',
      scope: 'RESOURCE',
      meaning: 'Server-assigned: delivered but not yet opened by the recipient.',
      provenance: {
        status: 'DOCUMENTED',
        citation: `${TYPES_CONTRACT}."1"; docs/katchup-flow.md ("1/2 are read-receipt states the server assigns")`,
        note: 'Documented only. This value appears in NO captured response sample in the repository.',
      },
    },
    {
      stateId: 'katchup.message.read',
      resource: 'katchup.message',
      term: 'Read',
      rawValue: '2',
      field: 'status',
      representation: 'NUMERIC_CODE',
      role: 'LIFECYCLE',
      scope: 'RESOURCE',
      meaning: 'Server-assigned: the recipient has opened the message.',
      provenance: {
        status: 'DOCUMENTED',
        citation: `${TYPES_CONTRACT}."2"; ${CONVERSATION_SAMPLE}`,
        note:
          'In the documented sample every row with status 2 also carries a non-null readTime, and ' +
          'every row with status 0 carries readTime: null. The correlation is documented, not measured.',
      },
    },
    {
      stateId: 'katchup.message.not-sent',
      resource: 'katchup.message',
      term: 'Not sent',
      rawValue: '3',
      field: 'status',
      representation: 'NUMERIC_CODE',
      role: 'LIFECYCLE',
      scope: 'RESOURCE',
      meaning: 'A failure state: the message was not delivered.',
      provenance: {
        status: 'DOCUMENTED',
        citation: `${TYPES_CONTRACT}."3"`,
        note:
          'Documented only. No sample shows it, no transition in any source produces it, and no ' +
          'source states what causes it.',
      },
    },
    {
      stateId: 'katchup.message.group-row',
      resource: 'katchup.message',
      term: 'Group',
      rawValue: '4',
      field: 'status',
      representation: 'NUMERIC_CODE',
      // NOT lifecycle. This is what CONF-KATCHUP-STATUS-OVERLOADED is about.
      role: 'CLASSIFIER',
      scope: 'RESOURCE',
      meaning:
        'Marks the row as belonging to a group conversation. It classifies the row rather than ' +
        'describing anything that has happened to the message, and the bench sends it as a routing value.',
      provenance: {
        status: 'CONFLICTED',
        citation: `${TYPES_CONTRACT}."4"; sent at tests/api/kpost/katchup/feature.spec.ts:291`,
        note:
          'Shares one field with the lifecycle codes, so a group message has no representable read ' +
          'state in `status`. See CONF-KATCHUP-STATUS-OVERLOADED.',
      },
    },
    {
      stateId: 'katchup.message.read-time-recorded',
      resource: 'katchup.message',
      term: 'readTime',
      rawValue: '<ISO timestamp> | null',
      field: 'readTime',
      representation: 'TIMESTAMP_PRESENCE',
      role: 'MARKER',
      scope: 'RESOURCE',
      meaning:
        'The recorded open date/time — the accountability field the product is built around. Null ' +
        'until the message is read.',
      provenance: {
        status: 'DOCUMENTED',
        citation: CONVERSATION_SAMPLE,
        note:
          'WHOSE perspective this reflects on a 1:1 message is UNKNOWN — the documented sample does ' +
          'not record which account made the call. See CONF-KATCHUP-READ-PERSPECTIVE.',
      },
    },
    {
      stateId: 'katchup.message.deleted',
      resource: 'katchup.message',
      term: 'deletedBy',
      rawValue: '<kpostID> | null',
      field: 'deletedBy',
      representation: 'ACTOR_REFERENCE',
      role: 'MARKER',
      scope: 'RESOURCE',
      meaning: 'Names the party who deleted the message. Null while nobody has.',
      provenance: {
        status: 'DOCUMENTED',
        citation: CONVERSATION_SAMPLE,
        note:
          'Distinct from the resource ledger`s CLEANED state, which records that the BENCH removed ' +
          'a record it created. Different subjects; see the Phase 4A discovery §2.1.',
      },
    },
    {
      stateId: 'katchup.message.important',
      resource: 'katchup.message',
      term: 'importantBy',
      rawValue: '<kpostID> | null',
      field: 'importantBy',
      representation: 'ACTOR_REFERENCE',
      role: 'MARKER',
      scope: 'RESOURCE',
      meaning: 'Names the party who marked the message important.',
      provenance: { status: 'DOCUMENTED', citation: CONVERSATION_SAMPLE },
    },
    {
      stateId: 'katchup.message.vanishing',
      resource: 'katchup.message',
      term: 'isVanished',
      rawValue: 'true | false',
      field: 'isVanished',
      representation: 'BOOLEAN_FLAG',
      role: 'MARKER',
      scope: 'RESOURCE',
      meaning:
        'The message is a "Disappear After Reading" secret message: it is removed once the ' +
        'recipient opens it.',
      provenance: {
        status: 'DOCUMENTED',
        citation: `src/api/definitions/kpost/katchup/send.api.ts:42; ${CONVERSATION_SAMPLE}`,
      },
    },
    {
      stateId: 'katchup.message.scheduled-expiry',
      resource: 'katchup.message',
      term: 'secretMessageExpireTime',
      rawValue: '<epoch ms> | null',
      field: 'secretMessageExpireTime',
      representation: 'TIMESTAMP_PRESENCE',
      role: 'MARKER',
      scope: 'RESOURCE',
      meaning:
        'The message is a "Disappear As Per Schedule" secret message, removed at the given time ' +
        'whether or not it was read.',
      provenance: {
        status: 'DOCUMENTED',
        citation: `src/api/definitions/kpost/katchup/send.api.ts:41; ${CONVERSATION_SAMPLE}`,
      },
    },
    {
      stateId: 'katchup.message.edited',
      resource: 'katchup.message',
      term: 'Edited',
      rawValue: 'messageType 6',
      field: 'messageType',
      representation: 'NUMERIC_CODE',
      role: 'MARKER',
      scope: 'RESOURCE',
      meaning: 'The message has been edited.',
      provenance: {
        status: 'DERIVED',
        citation:
          'tests/api/kpost/katchup/feature.spec.ts:177 ("the Edited: marker is a UI label over messageType 6")',
        note:
          'There is NO edited field. The repository infers the state from the message type, and the ' +
          'visible marker exists only in the UI. Recorded as DERIVED so it is never read as documented.',
      },
    },
    // ---- per-recipient, group messages only -----------------------------------------------------
    {
      stateId: 'katchup.message.recipient-read-status',
      resource: 'katchup.message',
      term: 'readStatus',
      rawValue: 'Y | N',
      field: 'readStatus',
      representation: 'YN_FLAG',
      role: 'LIFECYCLE',
      scope: 'PER_PARTICIPANT',
      meaning: 'Whether one named recipient has read the message.',
      provenance: {
        status: 'DOCUMENTED',
        citation: GROUP_RECEIPT_SAMPLE,
        note:
          'GROUP MESSAGES ONLY. getReadStatusGroupMessage is the sole per-recipient receipt, and no ' +
          '1:1 equivalent is documented anywhere in the contract.',
      },
    },
    {
      stateId: 'katchup.message.recipient-read-time',
      resource: 'katchup.message',
      term: 'readTime',
      rawValue: '<ISO timestamp> | null',
      field: 'readTime',
      representation: 'TIMESTAMP_PRESENCE',
      role: 'MARKER',
      scope: 'PER_PARTICIPANT',
      meaning: "One named recipient's open date/time.",
      provenance: {
        status: 'DOCUMENTED',
        citation: GROUP_RECEIPT_SAMPLE,
        note: 'Group messages only.',
      },
    },
  ],
};

export const KATCHUP_MESSAGE_TRANSITIONS: readonly StateTransition[] = [
  {
    transitionId: 'katchup.message.send',
    resource: 'katchup.message',
    from: null,
    action: 'katchup.send-message',
    to: 'katchup.message.sent',
    actor: 'sender',
    requirementIds: ['FR-KU-003'],
    mechanism: 'API',
    endpointId: 'katchup-send-message',
    provenance: {
      status: 'DOCUMENTED',
      citation:
        'docs/katchup-flow.md §3 (send contract); src/api/definitions/kpost/katchup/send.api.ts:34',
    },
  },
  {
    transitionId: 'katchup.message.read',
    resource: 'katchup.message',
    from: 'katchup.message.sent',
    action: 'katchup.open-conversation',
    to: 'katchup.message.read',
    actor: 'recipient',
    requirementIds: ['FR-K07'],
    // The motivating case for the mechanism vocabulary — see the file header.
    mechanism: 'UI',
    unavailableReason:
      'No endpoint marks a 1:1 Katchup message read. The web client marks a thread read as a side ' +
      'effect of opening the conversation, so there is no call to bind. Confirmed against the FULL ' +
      'documented contract, not just the registered subset: no Katchup path matching read/open/seen ' +
      'performs it. Driving this transition requires the UI.',
    provenance: {
      status: 'DOCUMENTED',
      citation:
        'docs/katchup-flow.md ("1/2 are read-receipt states the server assigns"); ' +
        'src/flows/catalogue/katchup-message-1to1.ts:119-123 (the Phase 2B unbound step)',
    },
  },
  {
    transitionId: 'katchup.message.recall',
    resource: 'katchup.message',
    from: 'katchup.message.sent',
    action: 'katchup.recall-message',
    to: 'katchup.message.deleted',
    actor: 'sender',
    // BR-K03 is a business-rule id from docs/business-rules.md, NOT a Phase 1 requirement id.
    // Referencing it here would fail the registry check, so it is cited in provenance instead.
    requirementIds: [],
    mechanism: 'API',
    endpointId: 'katchup-recall-message',
    provenance: {
      status: 'DOCUMENTED',
      citation:
        'src/api/definitions/kpost/katchup/manage.api.ts:19-30 ("Recall a sent message, removing it ' +
        'from the recipient\'s view"); docs/business-rules.md BR-K03',
      note:
        'The to-state is approximate: recall removes the message from the recipient view and leaves ' +
        'a sender-side "recalled" marker, but NO field records it — the repository proves recall only ' +
        'by the absence of body text. docs/business-rules.md BR-KU-RECALL-UNREAD additionally states ' +
        'recall is permitted only before the recipient has read it; that is an invariant, not a ' +
        'transition, and is deliberately not modelled here.',
    },
  },
  {
    transitionId: 'katchup.message.delete',
    resource: 'katchup.message',
    from: 'katchup.message.sent',
    action: 'katchup.delete-message',
    to: 'katchup.message.deleted',
    // No actor: the sources do not agree whether a recipient may delete a received message. Recorded
    // as absent rather than guessed. docs/business-rules.md BR-KU-DELETE-OWN is marked to-do.
    requirementIds: [],
    mechanism: 'API',
    endpointId: 'katchup-delete-message',
    provenance: {
      status: 'DOCUMENTED',
      citation: 'src/api/definitions/kpost/katchup/manage.api.ts:45',
      note: 'The actor is deliberately unset — no source states who may perform it.',
    },
  },
  {
    transitionId: 'katchup.message.mark-important',
    resource: 'katchup.message',
    from: 'katchup.message.sent',
    action: 'katchup.mark-important',
    to: 'katchup.message.important',
    requirementIds: [],
    mechanism: 'API',
    endpointId: 'katchup-mark-important',
    provenance: {
      status: 'DOCUMENTED',
      citation: 'src/api/definitions/kpost/katchup/manage.api.ts (katchup-mark-important)',
      note: 'Either party may mark a message important; no source states a restriction.',
    },
  },
  {
    transitionId: 'katchup.message.vanish-on-read',
    resource: 'katchup.message',
    from: 'katchup.message.vanishing',
    action: 'katchup.recipient-reads-vanishing-message',
    to: 'katchup.message.deleted',
    actor: 'recipient',
    requirementIds: ['FR-KU-017'],
    mechanism: 'UI',
    unavailableReason:
      'Reaches the same wall as the ordinary read: no endpoint marks a 1:1 message read, so nothing ' +
      'can trigger the disappearance. Nothing in the repository verifies that a vanishing message ' +
      'actually disappears.',
    provenance: {
      status: 'DOCUMENTED',
      citation:
        'CLAUDE.md §8 (Disappear After Reading — "stays until read"); docs/business-rules.md BR-KU-DISAPPEAR-READ',
    },
  },
  {
    transitionId: 'katchup.message.vanish-on-schedule',
    resource: 'katchup.message',
    from: 'katchup.message.scheduled-expiry',
    action: 'katchup.secret-message-expires',
    to: 'katchup.message.deleted',
    // No actor: the application performs it on a timer. Naming one would invent a participant.
    requirementIds: ['FR-KU-017'],
    mechanism: 'TIME',
    unavailableReason:
      'Time-driven with no actor and no endpoint. Verifying it needs a wait past the expiry plus a ' +
      'read-back, which is an execution concern outside this model.',
    provenance: {
      status: 'DOCUMENTED',
      citation:
        'CLAUDE.md §8 (Disappear As Per Schedule — "stays until that time"); docs/business-rules.md BR-KU-DISAPPEAR-SCHED',
    },
  },
];

export const KATCHUP_MESSAGE_OBSERVATIONS: readonly Observation[] = [
  {
    observationId: 'katchup.message.lifecycle-via-conversation',
    resource: 'katchup.message',
    observes: [
      'katchup.message.sent',
      'katchup.message.unread',
      'katchup.message.read',
      'katchup.message.not-sent',
      'katchup.message.group-row',
    ],
    endpointId: 'katchup-conversation',
    fieldPath: 'data[].status',
    runsOnLive: true,
    provenance: { status: 'DOCUMENTED', citation: CONVERSATION_SAMPLE },
    note:
      'The single most consequential entry in this model. The endpoint is registered, productionSafe ' +
      'and already runs on the default live pass (docs/LIVE-ENDPOINTS.md), yet no code in src/ or ' +
      'tests/ reads this field.',
  },
  {
    observationId: 'katchup.message.read-time-via-conversation',
    resource: 'katchup.message',
    observes: ['katchup.message.read-time-recorded'],
    endpointId: 'katchup-conversation',
    fieldPath: 'data[].readTime',
    runsOnLive: true,
    provenance: { status: 'DOCUMENTED', citation: CONVERSATION_SAMPLE },
    note: 'Whose perspective it reflects is unresolved — see CONF-KATCHUP-READ-PERSPECTIVE.',
  },
  {
    observationId: 'katchup.message.markers-via-conversation',
    resource: 'katchup.message',
    observes: [
      'katchup.message.deleted',
      'katchup.message.important',
      'katchup.message.vanishing',
      'katchup.message.scheduled-expiry',
    ],
    endpointId: 'katchup-conversation',
    fieldPath: 'data[].{deletedBy,importantBy,isVanished,secretMessageExpireTime}',
    runsOnLive: true,
    provenance: { status: 'DOCUMENTED', citation: CONVERSATION_SAMPLE },
  },
  {
    observationId: 'katchup.message.initial-state-via-send',
    resource: 'katchup.message',
    observes: ['katchup.message.sent'],
    endpointId: 'katchup-send-message',
    fieldPath: 'data[].status',
    runsOnLive: false,
    provenance: {
      status: 'DOCUMENTED',
      citation:
        'contracts/kpost-api.contract.json → POST /v2/katchup/sendMessage/ response example',
    },
    note:
      'The send response itself carries the message row, so the initial state is observable without ' +
      'a second call. runsOnLive is false only because the send is a gated lifecycle write.',
  },
  {
    observationId: 'katchup.message.recipient-receipts-via-group-read-status',
    resource: 'katchup.message',
    observes: ['katchup.message.recipient-read-status', 'katchup.message.recipient-read-time'],
    endpointId: 'katchup-read-status-group',
    fieldPath: 'data[].{readStatus,readTime}',
    runsOnLive: false,
    provenance: { status: 'DOCUMENTED', citation: GROUP_RECEIPT_SAMPLE },
    note:
      'GROUP MESSAGES ONLY, and needs a real group message id. There is no 1:1 equivalent. ' +
      'katchup-unopened-count is deliberately NOT modelled as an observation of message state: its ' +
      'documented response aggregates per SENDER ({sender, count}), so it cannot answer whether a ' +
      'particular message was read.',
  },
];
