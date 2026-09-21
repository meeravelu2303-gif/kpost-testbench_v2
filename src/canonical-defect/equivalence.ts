import {
  IDENTIFYING_DIMENSIONS,
  canonicalKey,
  dimensionValue,
  type DefectIdentity,
  type IdentifyingDimension,
} from './identity';

/**
 * Whether two sightings are the same defect (master plan §14).
 *
 * ## The asymmetry that shapes every rule here
 *
 *     a wrong SPLIT   files two tickets for one fault — noisy, visible, cheap to fix
 *     a wrong MERGE   hides a real fault inside a ticket somebody already closed — invisible
 *
 * They are not equally bad, so the rules are not symmetric. Equivalence must be POSITIVELY
 * supported: anything short of that is \`UNDECIDED\`, which files separately and leaves both faults
 * visible. The master plan says variants "can be grouped only when evidence supports equivalence",
 * and \`UNDECIDED\` is what "the evidence does not support it" looks like when you refuse to guess.
 */

export const EQUIVALENCE_VERDICTS = [
  /** Same defect. Every identifying dimension agrees. */
  'SAME',
  /** Demonstrably different: an identifying dimension disagrees. */
  'DIFFERENT',
  /** Might be the same; the evidence does not establish it. Files separately, by design. */
  'UNDECIDED',
] as const;
export type EquivalenceVerdict = (typeof EQUIVALENCE_VERDICTS)[number];

export interface EquivalenceResult {
  readonly verdict: EquivalenceVerdict;
  /** Dimensions that agree. */
  readonly agreeOn: readonly IdentifyingDimension[];
  /** Dimensions that disagree — the reason a merge is refused. */
  readonly differOn: readonly IdentifyingDimension[];
  /** Dimensions neither sighting recorded, so they establish nothing either way. */
  readonly unknownOn: readonly IdentifyingDimension[];
  readonly reason: string;
}

/**
 * Dimensions that must be POSITIVELY present on both sides before anything can be called the same
 * defect.
 *
 * Without them the comparison degenerates into "two findings in the same module", which is the
 * merge-by-resemblance this module exists to prevent. \`observableBehaviour\` is here because it is
 * the only dimension that says what is actually wrong; \`module\` and \`action\` because a behaviour
 * phrase alone is too coarse to locate a fault.
 */
const REQUIRED_FOR_EQUIVALENCE: readonly IdentifyingDimension[] = [
  'module',
  'action',
  'observableBehaviour',
];

/**
 * Compares two sightings.
 *
 * Pure and symmetric: \`equivalence(a, b)\` and \`equivalence(b, a)\` give the same verdict.
 */
export function equivalence(a: DefectIdentity, b: DefectIdentity): EquivalenceResult {
  const agreeOn: IdentifyingDimension[] = [];
  const differOn: IdentifyingDimension[] = [];
  const unknownOn: IdentifyingDimension[] = [];

  for (const dimension of IDENTIFYING_DIMENSIONS) {
    const left = dimensionValue(a, dimension);
    const right = dimensionValue(b, dimension);
    if (left === '' || right === '') unknownOn.push(dimension);
    else if (left === right) agreeOn.push(dimension);
    else differOn.push(dimension);
  }

  if (differOn.length > 0) {
    return {
      verdict: 'DIFFERENT',
      agreeOn,
      differOn,
      unknownOn,
      reason:
        `Two defects: they disagree on ${differOn.join(', ')}. Agreeing on ` +
        `${agreeOn.length > 0 ? agreeOn.join(', ') : 'nothing else'} does not make them one fault.`,
    };
  }

  const missing = REQUIRED_FOR_EQUIVALENCE.filter((dimension) => unknownOn.includes(dimension));
  if (missing.length > 0) {
    return {
      verdict: 'UNDECIDED',
      agreeOn,
      differOn,
      unknownOn,
      reason:
        `Nothing contradicts a merge, but ${missing.join(' and ')} ` +
        `${missing.length === 1 ? 'is' : 'are'} not recorded on both sightings, so equivalence is ` +
        'not established. They file separately: a wrong split is noisy, a wrong merge is invisible.',
    };
  }

  return {
    verdict: 'SAME',
    agreeOn,
    differOn,
    unknownOn,
    reason:
      `One defect seen twice: ${agreeOn.join(', ')} all agree, including the observable ` +
      `behaviour (${a.observableBehaviour}).`,
  };
}

/** A defect and every sighting of it. */
export interface CanonicalDefect {
  readonly key: string;
  readonly identity: DefectIdentity;
  readonly sightings: readonly DefectIdentity[];
  /** The surfaces this defect has been seen on. */
  readonly variants: readonly string[];
}

/**
 * Groups sightings into canonical defects.
 *
 * A sighting joins an existing group only on a \`SAME\` verdict — never on \`UNDECIDED\`, which is
 * what makes the refusal to guess actually cost something rather than being a comment. Grouping is
 * deterministic: input order cannot change the result, because \`SAME\` requires every identifying
 * dimension to agree, so a sighting can match at most one group.
 */
export function groupDefects(sightings: readonly DefectIdentity[]): CanonicalDefect[] {
  const groups = new Map<string, DefectIdentity[]>();
  for (const sighting of sightings) {
    const key = canonicalKey(sighting);
    const existing = groups.get(key);
    if (existing) existing.push(sighting);
    else groups.set(key, [sighting]);
  }

  return [...groups.entries()].map(([key, members]) => ({
    key,
    identity: members[0] as DefectIdentity,
    sightings: members,
    variants: [...new Set(members.map((member) => member.variant))].sort(),
  }));
}

/** One line per defect, for a report. Carries dimensions, never a message or a credential. */
export function summariseDefects(defects: readonly CanonicalDefect[]): string[] {
  return defects.map(
    (defect) =>
      `${defect.identity.module}/${defect.identity.feature}: ${defect.identity.observableBehaviour} ` +
      `[${defect.variants.join('+')}] — ${String(defect.sightings.length)} sighting(s)`,
  );
}
