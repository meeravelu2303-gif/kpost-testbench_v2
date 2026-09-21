import { hasUsableProvenance } from '../../states/provenance';
import { CROSS_CUTTING_INVARIANTS } from './catalogue/cross-cutting';
import { GROUP_INVARIANTS } from './catalogue/group';
import { KALL_INVARIANTS } from './catalogue/kall';
import { KATCHUP_INVARIANTS } from './catalogue/katchup';
import { KMAIL_INVARIANTS } from './catalogue/kmail';
import {
  ADMIN_INVARIANTS,
  KDIRECTORY_INVARIANTS,
  SIGNUP_LOGIN_INVARIANTS,
} from './catalogue/platform';
import {
  isInvariantModule,
  isInvariantStatus,
  type BusinessInvariant,
  type InvariantModule,
  type InvariantStatus,
} from './invariant';

/** Every declared business invariant, in module order. */
export const BUSINESS_INVARIANTS: readonly BusinessInvariant[] = [
  ...SIGNUP_LOGIN_INVARIANTS,
  ...KATCHUP_INVARIANTS,
  ...GROUP_INVARIANTS,
  ...KALL_INVARIANTS,
  ...KMAIL_INVARIANTS,
  ...KDIRECTORY_INVARIANTS,
  ...ADMIN_INVARIANTS,
  ...CROSS_CUTTING_INVARIANTS,
];

export function invariant(invariantId: string): BusinessInvariant | undefined {
  return BUSINESS_INVARIANTS.find((entry) => entry.invariantId === invariantId);
}

export function hasInvariant(invariantId: string): boolean {
  return invariant(invariantId) !== undefined;
}

export function invariantsOf(module: InvariantModule): BusinessInvariant[] {
  return BUSINESS_INVARIANTS.filter((entry) => entry.module === module);
}

export function invariantsWithStatus(status: InvariantStatus): BusinessInvariant[] {
  return BUSINESS_INVARIANTS.filter((entry) => entry.status === status);
}

/** Invariants that name a requirement id — the requirement → rule direction Phase 7 will need. */
export function invariantsForRequirement(requirementId: string): BusinessInvariant[] {
  return BUSINESS_INVARIANTS.filter((entry) => entry.requirements.includes(requirementId));
}

/** Invariants carrying an unresolved disagreement. Never empty by design — see the catalogue. */
export function conflictedInvariants(): BusinessInvariant[] {
  return BUSINESS_INVARIANTS.filter((entry) => entry.conflict !== undefined);
}

export const INVARIANT_PROBLEM_CODES = [
  'DUPLICATE_ID',
  'UNKNOWN_MODULE',
  'UNKNOWN_STATUS',
  'EMPTY_STATEMENT',
  'EMPTY_EXPECTATION',
  'UNUSABLE_PROVENANCE',
  'NO_EVIDENCE_KIND',
  'UNKNOWN_REQUIREMENT',
  'UNKNOWN_ACTOR',
  'UNKNOWN_STATE',
  'UNKNOWN_ENDPOINT',
  'VERIFIED_WITHOUT_SPEC',
  'PARTIAL_WITHOUT_GAP',
  'OUT_OF_SCOPE_WITHOUT_REASON',
  'CONFLICTED_PROVENANCE_WITHOUT_CONFLICT',
] as const;
export type InvariantProblemCode = (typeof INVARIANT_PROBLEM_CODES)[number];

export interface InvariantProblem {
  readonly code: InvariantProblemCode;
  readonly invariantId: string;
  readonly detail: string;
}

/**
 * What the validator needs to know about the rest of the repository.
 *
 * Injected rather than imported so this module stays free of the requirement registry, the actor
 * model, the state catalogue and the API registry. `traceability.ts` in the requirements layer takes
 * its inputs the same way, and for the same reason: a layer that reaches for everything it wants to
 * check eventually becomes a layer everything depends on.
 */
export interface InvariantVocabulary {
  readonly isKnownRequirement: (id: string) => boolean;
  readonly isKnownActor: (id: string) => boolean;
  readonly isKnownState: (id: string) => boolean;
  readonly isKnownEndpoint: (id: string) => boolean;
}

/**
 * Every way a declared invariant can be wrong, reported together rather than thrown one at a time.
 *
 * The status rules are the substance: a `VERIFIED` invariant must NAME the spec that demonstrates
 * it, a `PARTIAL` one must say what is still missing, and an `OUT_OF_SCOPE` one must say why. Those
 * three checks are what stop this catalogue turning into the thing it was built to replace — a list
 * of rules everyone assumes are covered.
 */
export function validateInvariants(
  invariants: readonly BusinessInvariant[],
  vocabulary: InvariantVocabulary,
): InvariantProblem[] {
  const problems: InvariantProblem[] = [];
  const add = (code: InvariantProblemCode, invariantId: string, detail: string): void => {
    problems.push({ code, invariantId, detail });
  };
  const seen = new Set<string>();

  for (const entry of invariants) {
    const id = entry.invariantId;
    if (seen.has(id)) add('DUPLICATE_ID', id, 'declared more than once');
    seen.add(id);

    if (!isInvariantModule(entry.module)) add('UNKNOWN_MODULE', id, entry.module);
    if (!isInvariantStatus(entry.status)) add('UNKNOWN_STATUS', id, entry.status);
    if (!entry.statement.trim())
      add('EMPTY_STATEMENT', id, 'a rule with no statement states nothing');
    if (!entry.expected.trim()) add('EMPTY_EXPECTATION', id, 'no concrete check was named');
    if (!hasUsableProvenance(entry.provenance)) {
      add(
        'UNUSABLE_PROVENANCE',
        id,
        'provenance needs a status and a citation a reviewer can open',
      );
    }
    if (!entry.evidence.length) {
      add('NO_EVIDENCE_KIND', id, 'nothing states what would prove the rule');
    }

    for (const requirementId of entry.requirements) {
      if (!vocabulary.isKnownRequirement(requirementId)) {
        add('UNKNOWN_REQUIREMENT', id, requirementId);
      }
    }
    for (const actor of entry.actors) {
      if (!vocabulary.isKnownActor(actor)) add('UNKNOWN_ACTOR', id, actor);
    }
    for (const stateId of entry.observedStates ?? []) {
      if (!vocabulary.isKnownState(stateId)) add('UNKNOWN_STATE', id, stateId);
    }
    for (const endpointId of entry.appliesTo) {
      // A UI-only action has no endpoint id; those are written as a phrase with a space in it, and
      // an id-shaped string is held to the registry so a typo cannot masquerade as coverage.
      if (!endpointId.includes(' ') && !vocabulary.isKnownEndpoint(endpointId)) {
        add('UNKNOWN_ENDPOINT', id, endpointId);
      }
    }

    if (entry.status === 'VERIFIED' && !entry.verifiedBy?.trim()) {
      add('VERIFIED_WITHOUT_SPEC', id, 'VERIFIED must name the spec that demonstrates the rule');
    }
    if (entry.status === 'PARTIAL' && !(entry.verifiedBy?.trim() && entry.gap?.trim())) {
      add('PARTIAL_WITHOUT_GAP', id, 'PARTIAL must name both the spec and what is still missing');
    }
    if (entry.status === 'OUT_OF_SCOPE' && !entry.gap?.trim()) {
      add('OUT_OF_SCOPE_WITHOUT_REASON', id, 'OUT_OF_SCOPE must say why it cannot be exercised');
    }
    if (entry.provenance.status === 'CONFLICTED' && !entry.conflict?.trim()) {
      add(
        'CONFLICTED_PROVENANCE_WITHOUT_CONFLICT',
        id,
        'provenance says the sources disagree, but the disagreement is not recorded',
      );
    }
  }
  return problems;
}

export interface InvariantSummary {
  readonly total: number;
  readonly byModule: Readonly<Record<string, number>>;
  readonly byStatus: Readonly<Record<InvariantStatus, number>>;
  readonly conflicted: number;
}

export function invariantSummary(): InvariantSummary {
  const byModule: Record<string, number> = {};
  const byStatus: Record<string, number> = {
    VERIFIED: 0,
    PARTIAL: 0,
    TO_DO: 0,
    OUT_OF_SCOPE: 0,
  };
  for (const entry of BUSINESS_INVARIANTS) {
    byModule[entry.module] = (byModule[entry.module] ?? 0) + 1;
    byStatus[entry.status] = (byStatus[entry.status] ?? 0) + 1;
  }
  return {
    total: BUSINESS_INVARIANTS.length,
    byModule,
    byStatus: byStatus as Record<InvariantStatus, number>,
    conflicted: conflictedInvariants().length,
  };
}
