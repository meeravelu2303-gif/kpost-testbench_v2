import type { BusinessInvariant } from '../invariant';

/**
 * Cross-cutting rules — the ones no single module can satisfy.
 *
 * BR-X01 is the clearest example of why this file exists separately. "Read receipts behave
 * identically in Katchup and KMail" cannot be verified by testing either module: a Katchup receipt
 * test passing and a KMail receipt test passing says nothing about whether the two AGREE. The rule
 * is about the relationship, so its evidence must compare the two representations directly.
 */
export const CROSS_CUTTING_INVARIANTS: readonly BusinessInvariant[] = [
  {
    invariantId: 'NFR-SEC01',
    module: 'cross-cutting',
    statement: 'Every authenticated operation requires a valid JWT.',
    provenance: {
      status: 'DOCUMENTED',
      citation: 'CLAUDE.md §4 — NFR-SEC01 maps onto the authentication validators',
    },
    requirements: ['NFR-SEC01'],
    actors: ['sender'],
    appliesTo: [],
    preconditions: ['an endpoint declaring authentication.required'],
    expected:
      'a missing, malformed, invalid or unsigned token is rejected on every authenticated endpoint',
    evidence: ['REJECTION'],
    status: 'VERIFIED',
    verifiedBy:
      'src/validators/authentication/missing-token.validator.ts — with its four siblings, run by the engine on every registered endpoint',
  },
  {
    invariantId: 'BR-X01',
    module: 'cross-cutting',
    statement:
      'Read receipts behave identically in Katchup and KMail: both record a per-recipient open date and time.',
    provenance: { status: 'DOCUMENTED', citation: 'CLAUDE.md §2 Cross-module rules → BR-X01' },
    requirements: ['FR-KU-007', 'FR-KM-020'],
    actors: ['sender', 'recipient'],
    appliesTo: ['katchup-read-status-group', 'kmail-group-read-status'],
    preconditions: [
      'a Katchup message and a KMail mail, each sent to a recipient the bench controls',
    ],
    observedStates: ['katchup.message.recipient-read-time', 'kmail.transaction.read-time'],
    expected:
      'both modules move from "no read time" to "a read time for that recipient" on the same trigger, and neither records one before the recipient reads',
    evidence: ['STATE_TRANSITION', 'CROSS_ACTOR'],
    status: 'TO_DO',
    gap: "neither side's transition is driven yet, and the comparison BETWEEN them has no home until flow execution exists.",
    conflict:
      'CONF-KATCHUP-READ-PERSPECTIVE applies here too: if the Katchup read transition is performed by the API read itself rather than by a UI action, the two modules may not be comparable on the same trigger at all. Preserved.',
  },
  {
    invariantId: 'BR-X02',
    module: 'cross-cutting',
    statement: 'Account, password and acceptable-use rules are platform-wide, not per module.',
    provenance: { status: 'DOCUMENTED', citation: 'CLAUDE.md §2 Cross-module rules → BR-X02' },
    requirements: ['NFR-SEC03'],
    actors: ['sender'],
    appliesTo: [],
    preconditions: ['an account operation in more than one module'],
    expected: 'the same account rule produces the same outcome whichever module invokes it',
    evidence: ['CROSS_ACTOR'],
    status: 'TO_DO',
    gap: 'the password rule itself is OUT_OF_SCOPE (BR-SL-PWD), so the cross-module comparison has nothing to compare yet.',
  },
];
