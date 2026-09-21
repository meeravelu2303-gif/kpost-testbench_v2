import type { BusinessInvariant } from '../invariant';

const FRD =
  'D:/Kpost Documents/KPOST_FRD_Module4_KMail_v1.8.docx (via docs/business-rules.md § KMail)';

/**
 * KMail — recipients, delivery/read state and the send constraints.
 *
 * BR-M01 is the one that matters across modules: KMail's read receipt must behave identically to
 * Katchup's (BR-X01). Declaring it here and in `cross-cutting.ts` is deliberate — the cross-module
 * rule is about the RELATIONSHIP between the two, and it cannot be satisfied by verifying either
 * module alone.
 */
export const KMAIL_INVARIANTS: readonly BusinessInvariant[] = [
  {
    invariantId: 'FR-KM-005',
    module: 'kmail',
    statement: 'The To: field accepts exactly ONE recipient; any further recipients go to Cc.',
    provenance: { status: 'DOCUMENTED', citation: `${FRD} → FR-KM-005` },
    requirements: ['FR-KM-005'],
    actors: ['sender', 'recipient', 'copy-recipient'],
    appliesTo: ['kmail-post-mail'],
    preconditions: ['two recipient accounts'],
    expected: 'a send naming a second To recipient is refused',
    evidence: ['REJECTION'],
    status: 'PARTIAL',
    verifiedBy: 'tests/api/kmail/feature.spec.ts',
    gap: 'the single-To happy path with a Cc list is driven; a second To recipient is never attempted, so the refusal is unverified.',
  },
  {
    invariantId: 'BR-M01',
    module: 'kmail',
    statement:
      'Each mail records a per-recipient read receipt with the exact date and time the recipient opened it.',
    provenance: { status: 'DOCUMENTED', citation: `${FRD} → BR-M01; SRS-M02` },
    requirements: ['FR-KM-020'],
    actors: ['sender', 'recipient'],
    appliesTo: ['kmail-group-read-status', 'kmail-sent-not-opened', 'kmail-mail-content'],
    preconditions: ['a mail sent to a recipient the bench controls'],
    observedStates: ['kmail.transaction.read', 'kmail.transaction.read-time'],
    expected:
      'before the recipient opens it there is no read time; after they open it a read time appears for that recipient',
    evidence: ['STATE_TRANSITION', 'CROSS_ACTOR'],
    status: 'TO_DO',
    gap: 'the Phase 4D calibration read the KMail delivery/read representation but did not drive the transition.',
  },
  {
    invariantId: 'FR-KM-010',
    module: 'kmail',
    statement:
      'A mail carries a priority of Low, Medium or High, defaulting to Low; High is the distinct flag.',
    provenance: { status: 'DOCUMENTED', citation: `${FRD} → FR-KM-010/011` },
    requirements: ['FR-KM-010', 'FR-KM-011'],
    actors: ['sender', 'recipient'],
    appliesTo: ['kmail-post-mail'],
    preconditions: ['a recipient account'],
    expected: 'a mail sent as High reads back carrying the High priority flag',
    evidence: ['READ_BACK'],
    status: 'PARTIAL',
    verifiedBy: 'tests/api/kmail/feature.spec.ts',
    gap: 'the high-priority send is driven; the priority is not read back, and the Low default is not checked.',
  },
  {
    invariantId: 'BR-KM-SALUTE',
    module: 'kmail',
    statement:
      'The salutation is one of {Hi, Hello, Dear, Sir, Madam, Respect}, defaulting to Hi; anything else is rejected or normalised.',
    provenance: { status: 'DOCUMENTED', citation: `${FRD} → BR-KM-SALUTE` },
    requirements: ['FR-KM-004'],
    actors: ['sender'],
    appliesTo: ['kmail-post-mail', 'kmail-saluations'],
    preconditions: ['a recipient account'],
    expected: 'a salutation outside the documented set is refused, or normalised to one inside it',
    evidence: ['REJECTION', 'READ_BACK'],
    status: 'TO_DO',
  },
  {
    invariantId: 'BR-KM-BODY',
    module: 'kmail',
    statement: 'Sending a mail requires body text.',
    provenance: { status: 'DOCUMENTED', citation: `${FRD} → BR-KM-BODY` },
    requirements: ['FR-KM-004'],
    actors: ['sender'],
    appliesTo: ['kmail-post-mail'],
    preconditions: ['a recipient account'],
    expected: 'a send with an empty body is refused',
    evidence: ['REJECTION'],
    status: 'TO_DO',
  },
  {
    invariantId: 'BR-KM-EXTERNAL',
    module: 'kmail',
    statement: 'A non-KPost email address is accepted as a recipient.',
    provenance: {
      status: 'DOCUMENTED',
      citation: `${FRD} → FR-KM-021..025 external interoperability`,
    },
    requirements: ['FR-KM-021'],
    actors: ['sender', 'recipient'],
    appliesTo: ['kmail-post-mail'],
    preconditions: ['a mailbox the bench controls outside the KPost domain'],
    expected: 'a send to an external address is accepted and recorded with that recipient',
    evidence: ['RESPONSE_FIELD', 'READ_BACK'],
    status: 'OUT_OF_SCOPE',
    gap: 'delivering to a real external mailbox is an `external` side effect: the SMS/OTP kill-switch class. It would need a bench-owned external mailbox and an explicit owner decision.',
  },
];
