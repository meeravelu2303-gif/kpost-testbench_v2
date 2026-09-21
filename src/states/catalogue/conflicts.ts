import type { StateConflict } from '../conflict';

/**
 * Every unresolved disagreement about application state, preserved in full.
 *
 * These are not defects to be triaged and not questions to be answered by reading harder. Each needs
 * new evidence — a gated live observation, or a statement from the API owner — and until that exists
 * the model carries both readings rather than one guess.
 */
export const STATE_CONFLICTS: readonly StateConflict[] = [
  {
    conflictId: 'CONF-KATCHUP-STATUS-OVERLOADED',
    resource: 'katchup.message',
    kind: 'FIELD_MEANING',
    subject:
      'One `status` field carries both a message lifecycle and a conversation-kind discriminator',
    positions: [
      {
        claim:
          'katchupStatus is a delivery/read lifecycle: 0 Sent, 1 Unread, 2 Read, 3 Not sent — "1/2 ' +
          'are read-receipt states the server assigns; 3 is a failure state".',
        citation: 'docs/katchup-flow.md §"status — delivery state of a message row"',
      },
      {
        claim:
          'The same field also carries 4 "Group", which marks a group row rather than anything that ' +
          'has happened to the message, and the bench SENDS it as a routing value on a group send.',
        citation:
          'contracts/kpost-types.json → katchupStatus."4"; tests/api/kpost/katchup/feature.spec.ts:291',
      },
    ],
    additionalEvidence: [
      {
        claim:
          'Consequence, not a resolution: a message whose status is 4 has no representable read ' +
          'state in this field, so per-recipient read state for group messages must come from ' +
          'getReadStatusGroupMessage instead.',
        citation: 'contracts/kpost-api.contract.json → getReadStatusGroupMessage response example',
      },
    ],
    resolutionRequires:
      'A statement from the API owner on whether 4 is mutually exclusive with 0–3, or whether a ' +
      'group row carries its read state elsewhere. A live observation of a group message row would ' +
      'narrow it but not settle the intent.',
    status: 'UNRESOLVED',
  },
  {
    conflictId: 'CONF-KATCHUP-READ-PERSPECTIVE',
    resource: 'katchup.message',
    kind: 'FIELD_MEANING',
    subject: 'Whose read state `status`/`readTime` reflect on a 1:1 conversation read',
    positions: [
      {
        claim:
          "It reflects the RECIPIENT's open time, visible to the sender — which is what FR-K07 and " +
          'the product\'s "per-recipient open date/time" differentiator require. The documented ' +
          "sample supports this: rows the sample's subject SENT carry status 2 with a populated " +
          'readTime.',
        citation:
          'contracts/kpost-api.contract.json → katchupMessagesForSelectedContactID response example; CLAUDE.md §1',
      },
      {
        claim:
          "It reflects the CALLER's own view of the row, in which case a sender could not learn the " +
          "recipient's open time from this endpoint and the 1:1 read receipt would remain " +
          'unobservable.',
        citation:
          'src/flows/catalogue/katchup-message-1to1.ts:132-136 (Phase 2A: "No 1:1 read-receipt endpoint is registered")',
      },
    ],
    additionalEvidence: [
      {
        claim:
          'The documented sample does not record WHICH ACCOUNT made the call, so it cannot ' +
          'discriminate between the two readings. This is why the question is open rather than answered.',
        citation: 'contracts/kpost-api.contract.json (samples carry no caller identity)',
      },
    ],
    resolutionRequires:
      'ONE gated live observation: send A→B, have B read, then call katchup-conversation as A and ' +
      'again as B, and compare data[].status / data[].readTime. This is the single highest-value ' +
      'measurement available to a future phase.',
    status: 'UNRESOLVED',
  },
  {
    conflictId: 'CONF-KALL-STATUS-REPRESENTATION',
    resource: 'kall',
    kind: 'REPRESENTATION',
    subject: 'Kall status is documented in two incompatible shapes for the same endpoint',
    positions: [
      {
        claim:
          'A string label under `kallStatus`, with participants under `kallScheduleDetails[]` ' +
          'carrying `kallAcceptStatus` / `joinedStatus` as "Y"/"N". Example: kallStatus: "Scheduled".',
        citation:
          'contracts/kpost-api.contract.json → GET /v2/kall/todayKoolKall/ (the usable: false row)',
      },
      {
        claim:
          'A numeric code under `senderKallStatus`, with participants under `kallDetails[]` carrying ' +
          '`receiverKallStatus` / `joinStatus` / `deleteStatus` as numbers and booleans. Example: ' +
          'senderKallStatus: 6.',
        citation:
          'contracts/kpost-api.contract.json → GET /v2/kall/todayKoolKall/ (the usable: true row)',
      },
    ],
    additionalEvidence: [
      {
        claim:
          'Narrowing, NOT a resolution: the string-label row is marked usable: false by the contract ' +
          'converter (a retired/duplicate workbook row), while the numeric row is usable: true. The ' +
          'one live observation the repository records also saw a numeric value.',
        citation:
          'contracts/kpost-api.contract.json (usable flags); CLAUDE.md §8 2026-09-13 ("senderKallStatus: 7")',
      },
      {
        claim:
          'The types contract numbers the states (6 = Scheduled), so the numeric form is consistent ' +
          'with the enum while the string form matches the enum LABELS.',
        citation: 'contracts/kpost-types.json → kallStatus',
      },
    ],
    resolutionRequires:
      'A live read of kall-today-kool recording which field names and value types actually come ' +
      'back. The retired row must not simply be assumed dead — it may describe an older deployed build.',
    status: 'UNRESOLVED',
  },
  {
    conflictId: 'CONF-KALL-BR-C01',
    resource: 'kall',
    kind: 'TRANSITION_CLAIM',
    subject:
      'Whether the Scheduled(6) → ReScheduled(7) transition actually occurs on the current build',
    positions: [
      {
        claim:
          'It was observed on live: "sender status moves 6 (Scheduled) → 7 (ReScheduled) — seen in ' +
          'the todayKoolKall row (senderKallStatus: 7)".',
        citation:
          'CLAUDE.md §8 2026-09-13 Kall entry; docs/kall-flow.md ("BR-C01 confirmed"); docs/requirements-frd.md (FR-KL-004 "asserted on live")',
      },
      {
        claim:
          'It does not occur: "On the current build it stays 6 = Scheduled — part of the defect."',
        citation: 'tests/api/kpost/kall/feature.spec.ts:223',
      },
    ],
    additionalEvidence: [
      {
        claim:
          'The assertion that would decide it is guarded by `if (row?.senderKallStatus !== undefined)` ' +
          'and is a soft assert, so it reports nothing when the field is absent — meaning a passing ' +
          'run does not establish either position.',
        citation: 'tests/api/kpost/kall/feature.spec.ts:227-230',
      },
      {
        claim:
          'docs/business-rules.md marks BR-C01 "✅ (files)" — i.e. the rule FILES a violation rather ' +
          'than passing, which is consistent with the transition NOT occurring.',
        citation: 'docs/business-rules.md (BR-C01 row)',
      },
    ],
    resolutionRequires:
      'One gated KALL_LIFECYCLE run against the current build, recording data[0].senderKallStatus ' +
      'from the reschedule response and from a subsequent kall-today-kool read.',
    status: 'UNRESOLVED',
  },
  {
    conflictId: 'CONF-KMAIL-RECEIPT-COVERAGE',
    resource: 'kmail.transaction',
    kind: 'COVERAGE_CLAIM',
    subject: 'Whether the KMail read receipt (BR-M01 / FR-KM-020) is covered',
    positions: [
      {
        claim: 'FR-KM-020 "Read receipts" is COVERED, via "API receipts (BR-M01)".',
        citation: 'docs/requirements-frd.md (FR-KM-020 row)',
      },
      {
        claim: 'BR-M01 is ⬜ to-do, with the Spec column literally "to-do".',
        citation: 'docs/business-rules.md (BR-M01 row)',
      },
    ],
    additionalEvidence: [
      {
        claim:
          'The COVERED claim is wired into the endpoint definition: the mail SEND endpoint is tagged ' +
          "requirements: ['FR-KM-018', 'FR-KM-020'] — so sending a mail is recorded as satisfying " +
          'read receipts. No test reads any read-state field for KMail.',
        citation: 'src/api/definitions/kmail/send.api.ts:53',
      },
    ],
    resolutionRequires:
      'An owner decision on what "covered" means for a receipt, and re-tagging the requirement onto ' +
      'an observation rather than onto the send.',
    status: 'UNRESOLVED',
  },
  {
    conflictId: 'CONF-XMODULE-RECEIPT-PARITY',
    resource: null,
    kind: 'TERMINOLOGY',
    subject: 'BR-X01 claims Katchup and KMail read receipts behave identically',
    positions: [
      {
        claim:
          'They behave identically across the two modules — the cross-module accountability rule.',
        citation: 'CLAUDE.md §2 (BR-X01); docs/business-rules.md (cross-cutting BR-X01)',
      },
      {
        claim:
          'The documented data models differ materially. KMail records per-recipient deliveryStatus / ' +
          'readStatus / letterReadTime for EVERY mail, and exposes a sender-side "not opened" read ' +
          'that runs on live. Katchup carries a single status code plus readTime on the message, and ' +
          'its only per-recipient receipt endpoint is group-only.',
        citation:
          'contracts/kmail-api.contract.json (kmailTransactionList) vs contracts/kpost-api.contract.json (katchup message row)',
      },
    ],
    resolutionRequires:
      'Clarification of whether BR-X01 constrains user-visible behaviour or the data model. The ' +
      'model records the divergence either way; only the compliance question depends on the answer.',
    status: 'UNRESOLVED',
  },
];
