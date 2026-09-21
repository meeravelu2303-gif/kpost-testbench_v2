import type { ViolationType } from '../failure-analysis/classification';

/**
 * What a defect IS, as evidence rather than as prose (master plan §14).
 *
 * ## The prohibition this exists to enforce
 *
 *     do not merge merely because status codes or titles match
 *
 * Two endpoints answering 500 are not one defect; they are two endpoints answering 500. Two tickets
 * whose summaries read alike are not one defect; they are two summaries written by the same
 * generator. Merging on either is how a real second fault disappears into a ticket somebody already
 * closed — and unlike a duplicate, a wrongly-merged defect leaves no trace that it existed.
 *
 * So identity is a set of named dimensions, and two findings are the same defect only when the
 * dimensions that carry meaning agree. Nothing here reads a title, a message or a status code.
 *
 * ## Why this is separate from the bug fingerprint
 *
 * \`bug-fingerprint.ts\` answers a narrower question — has THIS check on THIS endpoint been filed
 * before? — and it does it well, by hashing \`endpointId | validatorName | message\`. It cannot
 * answer the question this module is for: are a finding on the API and a finding in the UI, or a
 * finding by the sender and one by the recipient, two views of ONE defect? Those differ in endpoint
 * and in message by construction, so the fingerprint says "different" every time, which is right for
 * dedup and useless for grouping.
 *
 * The fingerprint is left completely untouched. Nothing here changes a tag, so no filed ticket can
 * be orphaned or duplicated by this phase.
 */

/** Where the same defect can legitimately show up looking different. */
export const DEFECT_VARIANTS = ['API', 'UI', 'ACTOR'] as const;
export type DefectVariant = (typeof DEFECT_VARIANTS)[number];

/**
 * The dimensions a defect is identified by.
 *
 * Every field is evidence the bench already produces. \`observableBehaviour\` is the load-bearing
 * one: a short, structural phrase describing WHAT IS WRONG in the product's own terms
 * ("count-not-decremented-on-recall"), never a rendered message and never a status code. Two
 * findings that agree on everything else but differ here are two defects.
 */
export interface DefectIdentity {
  readonly module: string;
  readonly feature: string;
  /** Requirement ids this defect contradicts, if any are known. Order-insensitive. */
  readonly requirementIds?: readonly string[];
  /** The flow it was found in, when it was found in one. */
  readonly flowId?: string;
  /** The endpoint or screen the ACTION was taken against. */
  readonly action: string;
  /** The kind of thing that is wrong — a message, a group, a call. Not its id. */
  readonly resourceKind: string;
  /** Which participant relationship the defect involves, when it involves one. */
  readonly actorRelationship?: string;
  readonly failureCategory: ViolationType;
  /** A short structural phrase for the incorrect behaviour. Never a message, never a status. */
  readonly observableBehaviour: string;
  /** Which surface this particular sighting came from. */
  readonly variant: DefectVariant;
}

/**
 * The dimensions that decide identity, in the order a reader should think about them.
 *
 * \`variant\` is deliberately absent: it is what a defect can differ in while staying the same
 * defect, which is the whole reason for grouping. \`flowId\` is absent for the same reason — one
 * fault can be reached by several flows.
 */
export const IDENTIFYING_DIMENSIONS = [
  'module',
  'feature',
  'action',
  'resourceKind',
  'actorRelationship',
  'failureCategory',
  'observableBehaviour',
] as const;
export type IdentifyingDimension = (typeof IDENTIFYING_DIMENSIONS)[number];

/** The value of one dimension, normalised for comparison. Absent reads as the empty string. */
export function dimensionValue(identity: DefectIdentity, dimension: IdentifyingDimension): string {
  return (identity[dimension] ?? '').trim().toLowerCase();
}

/**
 * A stable key for the defect, ignoring the surface it was seen on.
 *
 * Two sightings with the same key are the same defect seen twice. It is a readable join rather than
 * a hash, on purpose: a canonical key a person cannot read is a grouping decision nobody can audit,
 * and this phase's failure mode is a wrong merge that never surfaces again.
 */
export function canonicalKey(identity: DefectIdentity): string {
  return IDENTIFYING_DIMENSIONS.map((dimension) => dimensionValue(identity, dimension)).join('|');
}
