import type { ActorRoleId } from '../../actors/index';
import type { Provenance } from '../../states/provenance';

/**
 * Business invariants — the product's LOGIC rules, declared once.
 *
 * ## Why this sits beside `business-rule.ts` rather than inside it
 *
 * `src/business-rules/business-rule.ts` is an EXECUTABLE rule: it takes a `ValidationContext` and
 * returns a `ValidationOutcome`, so it imports the validation engine and can only ever speak about
 * one endpoint's one response. That is a useful layer and it is untouched.
 *
 * This is the other half: a DECLARATIVE statement of what the product must do, independent of how
 * any test happens to check it. It imports no engine, no validator, no executor and no Bugzilla —
 * asserted by a framework guard — because an invariant that depends on the thing meant to verify it
 * cannot be used to judge that thing. Execution is Phase 6/7's job; this layer only says what is
 * true, who says so, and how well the bench currently demonstrates it.
 *
 * ## The rule this file exists to enforce
 *
 * **A rule is not verified because a test with a matching name passes.** The discovery phases found
 * the repository crediting itself with coverage it did not have — a mail SEND tagged as satisfying
 * "read receipts", a feature spec asserting `status < 300` under a comment claiming a business rule.
 * So `status` is not a free-text claim: `VERIFIED` and `PARTIAL` must name the spec that
 * demonstrates it, `PARTIAL` must say what is still missing, and nothing may be promoted to
 * `VERIFIED` because an endpoint carries a requirement id.
 *
 * Sources: the six per-module FRDs plus BRD/SRS/PRD/FSD in `D:\Kpost Documents`, transcribed through
 * `docs/business-rules.md`. Nothing here is inferred from a test title or an endpoint name.
 */

/**
 * How well the bench demonstrates the rule TODAY. Not how important the rule is, and not whether the
 * application obeys it — a `VERIFIED` rule can still be failing on live, which is the point.
 *
 *  - `VERIFIED`     — a named spec asserts the rule against the RESPONSE or a read-back state.
 *  - `PARTIAL`      — something is asserted, but not the whole rule (`gap` says what is missing).
 *  - `TO_DO`        — declared, nothing asserts it yet.
 *  - `OUT_OF_SCOPE` — cannot be exercised on the supported environment (`gap` says why).
 */
export const INVARIANT_STATUSES = ['VERIFIED', 'PARTIAL', 'TO_DO', 'OUT_OF_SCOPE'] as const;
export type InvariantStatus = (typeof INVARIANT_STATUSES)[number];

/** The product modules the catalogue covers, matching `docs/business-rules.md`'s sections. */
export const INVARIANT_MODULES = [
  'signup-login',
  'katchup',
  'group',
  'kall',
  'kmail',
  'kdirectory',
  'admin',
  'cross-cutting',
] as const;
export type InvariantModule = (typeof INVARIANT_MODULES)[number];

/**
 * What would PROVE the rule — the evidence a flow must capture, named before anything is built so a
 * later phase cannot quietly settle for something weaker.
 *
 *  - `RESPONSE_FIELD`   — a field in the response to the action itself.
 *  - `READ_BACK`        — a separate read of the resource after the action.
 *  - `STATE_TRANSITION` — a before/after pair of state observations.
 *  - `ABSENCE`          — the resource is demonstrably NOT visible where it must not be.
 *  - `CROSS_ACTOR`      — the same resource observed through a DIFFERENT actor's session.
 *  - `SIDE_EFFECT`      — a derived count, list or log entry changing as the rule requires.
 *  - `REJECTION`        — the application refusing the action, with the error it must give.
 */
export const EVIDENCE_KINDS = [
  'RESPONSE_FIELD',
  'READ_BACK',
  'STATE_TRANSITION',
  'ABSENCE',
  'CROSS_ACTOR',
  'SIDE_EFFECT',
  'REJECTION',
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export interface BusinessInvariant {
  /** The documented rule id (`BR-…`, `FR-…`, `NFR-…`), unique across the catalogue. */
  readonly invariantId: string;
  readonly module: InvariantModule;
  /** ONE sentence, in the product's terms, stating what MUST hold. Never a test description. */
  readonly statement: string;
  /** Where the statement comes from, and how strongly the repository supports it. */
  readonly provenance: Provenance;
  /**
   * Canonical requirement ids this rule serves. Validated against the Requirement Source Registry,
   * so a typo or an invented id fails rather than silently crediting coverage.
   */
  readonly requirements: readonly string[];
  /**
   * Whose view the rule constrains. A rule about what a RECIPIENT can see is not satisfied by
   * observing the sender, which is the distinction Phase 8 exists to enforce.
   */
  readonly actors: readonly ActorRoleId[];
  /** Registered endpoint ids, or a named UI action where no endpoint exists. */
  readonly appliesTo: readonly string[];
  /** What must already be true before the rule can be exercised at all. */
  readonly preconditions: readonly string[];
  /** State ids from `src/states` the rule speaks about, where the state model covers them. */
  readonly observedStates?: readonly string[];
  /** The relationship that must hold — the concrete check, never "the call was accepted". */
  readonly expected: string;
  readonly evidence: readonly EvidenceKind[];
  readonly status: InvariantStatus;
  /** The spec that demonstrates it. Required for VERIFIED and PARTIAL. */
  readonly verifiedBy?: string;
  /** What is still missing. Required for PARTIAL and OUT_OF_SCOPE. */
  readonly gap?: string;
  /**
   * A disagreement between sources, or between documentation and observed behaviour. Preserved
   * verbatim — this layer never resolves one.
   */
  readonly conflict?: string;
}

export function isInvariantStatus(value: string): value is InvariantStatus {
  return (INVARIANT_STATUSES as readonly string[]).includes(value);
}

export function isInvariantModule(value: string): value is InvariantModule {
  return (INVARIANT_MODULES as readonly string[]).includes(value);
}
