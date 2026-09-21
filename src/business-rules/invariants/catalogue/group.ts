import type { BusinessInvariant } from '../invariant';

const FRD = 'D:/Kpost Documents/KPOST_FRD_Group_v1.0.docx (via docs/business-rules.md § Group)';

/**
 * Group — membership and admin permissions.
 *
 * The two rules worth reading twice are the minimum-admin pair (FR-GM-013 / FR-GM-014). They are
 * the only Katchup rules that protect a group from becoming unadministrable, and the group feature
 * spec currently RECORDS a 2xx on the sole-admin exit as a finding rather than asserting a refusal —
 * which is the honest position while it is unknown whether the rule is enforced server-side or only
 * in the UI. That uncertainty is carried here rather than resolved.
 */
export const GROUP_INVARIANTS: readonly BusinessInvariant[] = [
  {
    invariantId: 'FR-GC-006',
    module: 'group',
    statement: 'A group cannot be created without at least one member besides the creator.',
    provenance: { status: 'DOCUMENTED', citation: `${FRD} → FR-GC-006` },
    requirements: ['FR-GC-006'],
    actors: ['group-admin'],
    appliesTo: ['group-create'],
    preconditions: ['an authenticated account with no other member selected'],
    expected: 'creating a group with an empty member list is refused',
    evidence: ['REJECTION'],
    status: 'TO_DO',
  },
  {
    invariantId: 'FR-GM-010',
    module: 'group',
    statement: 'Adding a member increases the group member count and lists that member.',
    provenance: { status: 'DOCUMENTED', citation: `${FRD} → FR-GM-010` },
    requirements: ['FR-GM-010'],
    actors: ['group-admin', 'group-member'],
    appliesTo: ['group-add-user', 'contacts-my-groups'],
    preconditions: ['an existing group the actor administers'],
    expected:
      'after the add, the count is one higher and the new member appears in the member list',
    evidence: ['SIDE_EFFECT', 'READ_BACK'],
    status: 'PARTIAL',
    verifiedBy: 'tests/api/kpost/group/feature.spec.ts',
    gap: 'the add is driven, but neither the count change nor the membership read-back is asserted.',
  },
  {
    invariantId: 'FR-GM-011',
    module: 'group',
    statement: 'Removing a member decreases the count and the user is no longer listed.',
    provenance: { status: 'DOCUMENTED', citation: `${FRD} → FR-GM-011` },
    requirements: ['FR-GM-011'],
    actors: ['group-admin', 'group-member'],
    appliesTo: ['group-remove-member', 'contacts-my-groups'],
    preconditions: ['a group with at least two members'],
    expected: 'after the removal, the count is one lower and the removed user is absent',
    evidence: ['SIDE_EFFECT', 'ABSENCE'],
    status: 'PARTIAL',
    verifiedBy: 'tests/api/kpost/group/feature.spec.ts',
    gap: 'the removal is driven; the count change and the absence are not asserted.',
  },
  {
    invariantId: 'FR-GM-012',
    module: 'group',
    statement: 'Add Admin promotes a member, after which both admins are listed as admins.',
    provenance: { status: 'DOCUMENTED', citation: `${FRD} → FR-GM-012` },
    requirements: ['FR-GM-012'],
    actors: ['group-admin', 'group-member'],
    appliesTo: ['group-admin-access', 'contacts-my-groups'],
    preconditions: ['a group with an admin and at least one ordinary member'],
    expected: 'the promoted member reads back with admin access, and the original admin keeps it',
    evidence: ['READ_BACK'],
    status: 'PARTIAL',
    verifiedBy: 'tests/api/kpost/group/feature.spec.ts',
    gap: 'the promotion is driven; the resulting admin list is not read back.',
  },
  {
    invariantId: 'FR-GM-013',
    module: 'group',
    statement: 'Remove Admin is permitted only while more than one admin exists.',
    provenance: { status: 'DOCUMENTED', citation: `${FRD} → FR-GM-013` },
    requirements: ['FR-GM-013'],
    actors: ['group-admin'],
    appliesTo: ['group-admin-access'],
    preconditions: ['a group with exactly one admin'],
    expected: 'demoting the only admin is refused',
    evidence: ['REJECTION'],
    status: 'TO_DO',
  },
  {
    invariantId: 'FR-GM-014',
    module: 'group',
    statement: 'The sole admin of a group cannot leave it until another admin exists.',
    provenance: { status: 'DOCUMENTED', citation: `${FRD} → FR-GM-014` },
    requirements: ['FR-GM-014'],
    actors: ['group-admin'],
    appliesTo: ['group-leave'],
    preconditions: ['a group whose only admin is the acting account'],
    expected: "the sole admin's exit is refused; once a second admin exists the exit succeeds",
    evidence: ['REJECTION'],
    status: 'PARTIAL',
    verifiedBy: 'tests/api/kpost/group/feature.spec.ts',
    gap: 'the spec drives the exit and RECORDS a 2xx as a business-rule finding rather than asserting a refusal.',
    conflict:
      'Whether this rule is enforced server-side or only in the UI is unconfirmed. The FRD states the rule without naming the layer, and the one live observation recorded a 2xx. Asserting a refusal now could file a defect against a rule the API was never meant to enforce, so the finding is recorded and the question left open.',
  },
  {
    invariantId: 'BR-GC-DELETE-EMPTY',
    module: 'group',
    statement: 'A group cannot be deleted while it still has members.',
    provenance: {
      status: 'OBSERVED',
      citation:
        'CLAUDE.md §8 2026-09-13 — deleteGroup answers 400 "you need to remove all the members"',
      note: 'Observed on live, not found in the FRD. Recorded as observed rather than documented, and flagged as possibly a defect rather than a rule.',
    },
    requirements: [],
    actors: ['group-admin'],
    appliesTo: ['group-delete'],
    preconditions: ['a group with at least one member remaining'],
    expected: 'deleting a group with members present is refused, naming the reason',
    evidence: ['REJECTION'],
    status: 'VERIFIED',
    verifiedBy:
      'tests/e2e/group.spec.ts (cleanup removes members first, as the application requires)',
    conflict:
      'No FRD states this. It may be intended behaviour or an API limitation; CLAUDE.md records it as "possibly a finding". Kept as OBSERVED so it is never cited as a documented requirement.',
  },
];
