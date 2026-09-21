import type { Observation } from '../observation';
import type { StateTransition } from '../transition';
import type { StateVocabulary } from '../vocabulary';

/**
 * KMail mail transaction — documented state, transitions and observation points.
 *
 * A "transaction" is KMail's own term for **one recipient's copy of one mail**
 * (`kmailTransactionList[]`). It is the richest state record in the repository: unlike Katchup, which
 * carries a single lifecycle code on the message, KMail breaks delivery, reading, replying and
 * deletion out per recipient for EVERY mail, not only for group mail.
 *
 * ## Actor roles are shared with Katchup, deliberately
 *
 * No `mail-sender` / `mail-recipient` roles are introduced. Phase 3 already established that the two
 * modules share one recipient model — Katchup's `revealContactList`/`hiddenContactList` and KMail's
 * `ccList`/`bccList` are the visible-copy and confidential-copy channels of one concept — so the
 * existing `sender` / `recipient` / `copy-recipient` / `confidential-copy-recipient` roles apply
 * unchanged. Duplicating them per module would fragment the vocabulary for no evidenced difference.
 */

const CONTENT_SAMPLE =
  'contracts/kmail-api.contract.json → POST /readMail/sentAndInboxMailContent/ response example';
const NOT_OPENED_SAMPLE =
  'contracts/kmail-api.contract.json → POST /common/sentMailNotOpened/ response example';

export const KMAIL_TRANSACTION_VOCABULARY: StateVocabulary = {
  resource: 'kmail.transaction',
  module: 'kmail',
  describe:
    "One recipient's copy of one mail, and the independent Y/N flags KMail records against it. The " +
    'only KPOST resource whose documentation separates delivery from reading.',
  provenance: { status: 'DOCUMENTED', citation: `${CONTENT_SAMPLE}; docs/kmail-flow.md` },
  identity: {
    field: 'transactionID',
    // A transaction is one recipient's copy of one mail, so it is qualified by the mail it belongs
    // to: transactionID is not stated to be unique on its own.
    parentField: 'kmailID',
    provenance: {
      status: 'DOCUMENTED',
      citation: `${CONTENT_SAMPLE} — value.kmailID with value.kmailTransactionList[].transactionID`,
    },
  },
  states: [
    {
      stateId: 'kmail.transaction.delivered',
      resource: 'kmail.transaction',
      term: 'deliveryStatus',
      rawValue: 'Y | N',
      field: 'deliveryStatus',
      representation: 'YN_FLAG',
      role: 'LIFECYCLE',
      scope: 'PER_PARTICIPANT',
      meaning: 'Whether the mail reached this recipient.',
      provenance: {
        status: 'DOCUMENTED',
        citation: CONTENT_SAMPLE,
        note:
          'Delivery is a distinct state from reading here. Katchup documents no equivalent — its ' +
          'status 0 ("Sent") conflates the two.',
      },
    },
    {
      stateId: 'kmail.transaction.read',
      resource: 'kmail.transaction',
      term: 'readStatus',
      rawValue: 'Y | N',
      field: 'readStatus',
      representation: 'YN_FLAG',
      role: 'LIFECYCLE',
      scope: 'PER_PARTICIPANT',
      meaning: 'Whether this recipient has opened the mail.',
      provenance: { status: 'DOCUMENTED', citation: `${CONTENT_SAMPLE}; ${NOT_OPENED_SAMPLE}` },
    },
    {
      stateId: 'kmail.transaction.read-time',
      resource: 'kmail.transaction',
      term: 'letterReadTime',
      rawValue: '<epoch ms> | null',
      field: 'letterReadTime',
      representation: 'TIMESTAMP_PRESENCE',
      role: 'MARKER',
      scope: 'PER_PARTICIPANT',
      meaning: "This recipient's exact open date/time — the BR-M01 accountability field.",
      provenance: {
        status: 'DOCUMENTED',
        citation: CONTENT_SAMPLE,
        note:
          'Unlike the Katchup readTime, this is unambiguously per recipient, so no perspective ' +
          'question arises here.',
      },
    },
    {
      stateId: 'kmail.transaction.replied',
      resource: 'kmail.transaction',
      term: 'replyStatus',
      rawValue: 'Y | N',
      field: 'replyStatus',
      representation: 'YN_FLAG',
      role: 'LIFECYCLE',
      scope: 'PER_PARTICIPANT',
      meaning: 'Whether this recipient has replied.',
      provenance: { status: 'DOCUMENTED', citation: CONTENT_SAMPLE },
    },
    {
      stateId: 'kmail.transaction.deleted-by-sender',
      resource: 'kmail.transaction',
      term: 'deleteBySender',
      rawValue: 'Y | N',
      field: 'deleteBySender',
      representation: 'YN_FLAG',
      role: 'MARKER',
      scope: 'PER_PARTICIPANT',
      meaning: 'The sender has deleted their copy — a soft delete.',
      provenance: {
        status: 'DOCUMENTED',
        citation: `${CONTENT_SAMPLE}; docs/kmail-flow.md (soft delete)`,
      },
    },
    {
      stateId: 'kmail.transaction.deleted-by-receiver',
      resource: 'kmail.transaction',
      term: 'deleteByReceiver',
      rawValue: 'Y | N',
      field: 'deleteByReceiver',
      representation: 'YN_FLAG',
      role: 'MARKER',
      scope: 'PER_PARTICIPANT',
      meaning: 'This recipient has deleted their copy — a soft delete.',
      provenance: {
        status: 'DOCUMENTED',
        citation: `${CONTENT_SAMPLE}; docs/kmail-flow.md (soft delete)`,
      },
    },
    {
      stateId: 'kmail.transaction.receiver-type',
      resource: 'kmail.transaction',
      term: 'receiverType',
      rawValue: '1 | 2 | 3',
      field: 'receiverType',
      representation: 'NUMERIC_CODE',
      // Addressing, not lifecycle — the same care taken with katchupStatus 4.
      role: 'CLASSIFIER',
      scope: 'PER_PARTICIPANT',
      meaning:
        'How this recipient was addressed: 1 TO, 2 COPY, 3 CONFIDENTIAL. It classifies the ' +
        'recipient, not anything that has happened to the mail.',
      provenance: {
        status: 'DOCUMENTED',
        citation: 'contracts/kpost-types.json → kmailReceiverType; docs/kmail-flow.md',
        note:
          'Recorded as a CLASSIFIER rather than a lifecycle state so it is never treated as a ' +
          'transition target. A confidential recipient (3) must remain hidden from the others ' +
          '(NFR-SEC02) — that is an invariant about visibility, not a state, and is not modelled here.',
      },
    },
  ],
};

export const KMAIL_TRANSACTION_TRANSITIONS: readonly StateTransition[] = [
  {
    transitionId: 'kmail.transaction.send',
    resource: 'kmail.transaction',
    from: null,
    action: 'kmail.post-mail',
    to: 'kmail.transaction.delivered',
    actor: 'sender',
    requirementIds: ['FR-KM-018'],
    mechanism: 'API',
    endpointId: 'kmail-post-mail',
    provenance: {
      status: 'DOCUMENTED',
      citation: `docs/kmail-flow.md (COMPOSE → postMail); ${NOT_OPENED_SAMPLE}`,
      note:
        'The documented sample of an unopened sent mail shows deliveryStatus "Y" with readStatus ' +
        '"N", which is what makes delivery and reading separable states.',
    },
  },
  {
    transitionId: 'kmail.transaction.read',
    resource: 'kmail.transaction',
    from: 'kmail.transaction.delivered',
    action: 'kmail.open-mail',
    to: 'kmail.transaction.read',
    actor: 'recipient',
    requirementIds: ['FR-KM-020'],
    // Same shape of gap as Katchup: the state is observable, the transition has no endpoint.
    mechanism: 'UI',
    unavailableReason:
      'No documented endpoint marks a mail read. The readMail/* endpoints RETRIEVE a mail; none is ' +
      'documented as recording the open. Whether retrieving a mail also marks it read is not stated ' +
      'anywhere, and assuming it would be invention.',
    provenance: {
      status: 'DOCUMENTED',
      citation: `docs/kmail-flow.md (read receipts record each recipient's open date/time, BR-M01); ${CONTENT_SAMPLE}`,
      note:
        'docs/requirements-frd.md marks FR-KM-020 COVERED while docs/business-rules.md marks BR-M01 ' +
        'to-do. See CONF-KMAIL-RECEIPT-COVERAGE.',
    },
  },
  {
    transitionId: 'kmail.transaction.reply',
    resource: 'kmail.transaction',
    from: 'kmail.transaction.read',
    action: 'kmail.reply',
    to: 'kmail.transaction.replied',
    actor: 'recipient',
    requirementIds: [],
    mechanism: 'API',
    endpointId: 'kmail-post-mail',
    provenance: {
      status: 'DOCUMENTED',
      citation: 'docs/kmail-flow.md (post-send action types, kmailType 1 = Reply)',
      note: 'A reply is a new mail carrying kmailType 1; the same endpoint sends it.',
    },
  },
  {
    transitionId: 'kmail.transaction.delete-by-receiver',
    resource: 'kmail.transaction',
    from: 'kmail.transaction.delivered',
    action: 'kmail.delete-mail',
    to: 'kmail.transaction.deleted-by-receiver',
    actor: 'recipient',
    requirementIds: ['FR-M07'],
    mechanism: 'API',
    endpointId: 'kmail-delete',
    provenance: {
      status: 'DOCUMENTED',
      citation: 'docs/kmail-flow.md ("a soft delete via deleteBySender/deleteByReceiver")',
      note: 'FR-M07 is a legacy id retained in the Phase 1 registry; KMail delete has no FR-KM-* id.',
    },
  },
];

export const KMAIL_TRANSACTION_OBSERVATIONS: readonly Observation[] = [
  {
    observationId: 'kmail.transaction.state-via-mail-content',
    resource: 'kmail.transaction',
    observes: [
      'kmail.transaction.delivered',
      'kmail.transaction.read',
      'kmail.transaction.read-time',
      'kmail.transaction.replied',
      'kmail.transaction.deleted-by-sender',
      'kmail.transaction.deleted-by-receiver',
      'kmail.transaction.receiver-type',
    ],
    endpointId: 'kmail-mail-content',
    fieldPath:
      'value.kmailTransactionList[].{deliveryStatus,readStatus,letterReadTime,replyStatus,deleteBySender,deleteByReceiver,receiverType}',
    runsOnLive: false,
    provenance: { status: 'DOCUMENTED', citation: CONTENT_SAMPLE },
    note:
      'The most complete state record documented anywhere in the repository, and read by nothing. ' +
      'runsOnLive is false because the read needs a real kmailID, supplied by the gated KMail lifecycle.',
  },
  {
    observationId: 'kmail.transaction.unread-via-sent-not-opened',
    resource: 'kmail.transaction',
    observes: ['kmail.transaction.read', 'kmail.transaction.delivered'],
    endpointId: 'kmail-sent-not-opened',
    fieldPath: 'value[].kmailTransactionList[].{readStatus,deliveryStatus}',
    runsOnLive: true,
    provenance: { status: 'DOCUMENTED', citation: NOT_OPENED_SAMPLE },
    note:
      "The SENDER's view of which sent mails a recipient has not opened — a genuine read-receipt " +
      'observation that runs on the default live pass. Katchup has no equivalent, which is the ' +
      'concrete asymmetry behind CONF-XMODULE-RECEIPT-PARITY.',
  },
  {
    observationId: 'kmail.transaction.group-receipts',
    resource: 'kmail.transaction',
    observes: ['kmail.transaction.read', 'kmail.transaction.read-time'],
    endpointId: 'kmail-group-read-status',
    fieldPath: 'value[].{readStatus,letterReadTime}',
    runsOnLive: false,
    provenance: {
      status: 'DERIVED',
      citation:
        'src/api/definitions/kmail/read.api.ts:375-383 (Per-recipient read status of a group mail)',
      note:
        'The endpoint is registered and summarised, but the repository holds NO documented response ' +
        'example for it, so the field path is inferred from the sibling transaction shape rather ' +
        'than read from a sample. Marked DERIVED for that reason; confirm before relying on it.',
    },
  },
];
