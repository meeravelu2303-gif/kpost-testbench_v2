import { requirement } from './registry';
import type { RequirementRecord } from './requirement';

/**
 * The minimum integration point between requirements and the rest of the bench.
 *
 * ## The rule that shapes this file
 *
 * Nothing here imports the endpoint registry, the engine, the reporters or the bug tracker. Every
 * function takes what it needs as an ARGUMENT, so the provenance layer has no dependency on
 * execution and cannot acquire one by accident. That is what keeps the boundary structural rather
 * than a matter of discipline:
 *
 *     Requirement Registry  →  knows nothing about how anything is executed
 *     Callers               →  pass in what they already hold
 *
 * ## What already exists, and is preserved unchanged
 *
 * `endpointId → requirementId` is already modelled: `EndpointDefinition.requirements` is a
 * `readonly string[]` of requirement ids, tagged on 15 definition files, and every id is already
 * enforced against the canonical set by `tests/framework/requirements-traceability.spec.ts`. This
 * phase adds a read-only lookup over it and changes neither the field, the tags, nor the guard.
 *
 * ## What does NOT exist, and is deliberately not invented
 *
 * `testCaseId → requirementId` has no representation anywhere in the repository. Specs carry
 * Playwright tags (`@katchup`, `@security`) and a derived `TC-…` identity, but no requirement
 * reference. See `TEST_CASE_TRACEABILITY_GAP` below: the gap is documented, not filled with guesses.
 */

/** The shape this module needs from an endpoint. Structural, so nothing imports the API layer. */
export interface RequirementTaggedEndpoint {
  id: string;
  requirements?: readonly string[];
}

/** An endpoint's requirement ids resolved to records, plus any id the registry does not know. */
export interface EndpointRequirementTrace {
  endpointId: string;
  /** Resolved provenance records, in the order the definition tags them. */
  requirements: readonly RequirementRecord[];
  /**
   * Tagged ids with no record. Empty in a healthy repository — the existing traceability guard
   * already fails the build on an unknown id — but reported rather than silently dropped.
   */
  unresolved: readonly string[];
}

/**
 * Resolves one endpoint's requirement tags to provenance records.
 *
 * Read-only and total: it never mutates the definition, never calls the network, and returns a
 * record for every id the registry knows plus a list of those it does not.
 */
export function traceEndpoint(endpoint: RequirementTaggedEndpoint): EndpointRequirementTrace {
  const records: RequirementRecord[] = [];
  const unresolved: string[] = [];
  for (const id of endpoint.requirements ?? []) {
    const record = requirement(id);
    if (record) records.push(record);
    else unresolved.push(id);
  }
  return { endpointId: endpoint.id, requirements: records, unresolved };
}

/** The reverse index: requirement id → the endpoint ids tagged with it. */
export function endpointsByRequirement(
  endpoints: readonly RequirementTaggedEndpoint[],
): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const endpoint of endpoints) {
    for (const id of endpoint.requirements ?? []) {
      const bucket = index.get(id) ?? [];
      bucket.push(endpoint.id);
      index.set(id, bucket);
    }
  }
  return index;
}

/** Requirement ids that no supplied endpoint references. A measurement, never an assertion. */
export function untracedRequirementIds(
  endpoints: readonly RequirementTaggedEndpoint[],
  candidateIds: readonly string[],
): string[] {
  const tagged = new Set(endpoints.flatMap((endpoint) => endpoint.requirements ?? []));
  return candidateIds.filter((id) => !tagged.has(id));
}

/**
 * The documented state of `testCaseId → requirementId`.
 *
 * Recorded as data so a future phase can read the gap rather than rediscover it, and so this file
 * cannot quietly grow a fabricated mapping instead.
 */
export const TEST_CASE_TRACEABILITY_GAP = {
  supported: false,
  /** What exists today that a future mapping could attach to, without changing behaviour now. */
  availableAnchors: [
    'Every executed case already has a stable identity: `TC-…` from src/reporting/test-case-id.ts, ' +
      'derived from the spec path and title path, and recorded on each ValidationResult and in ' +
      'reports/cases.jsonl.',
    'Playwright annotations are already used to carry a derived identity onto a case ' +
      '(TEST_CASE_ID_ANNOTATION), so the same mechanism could carry a requirement reference.',
    'Generated API cases already resolve an endpoint, and that endpoint already carries ' +
      '`requirements` — so `testCaseId → endpointId → requirementId` is derivable TODAY for the ' +
      'engine-generated cases without any new tagging.',
  ],
  /** Why it is not implemented in this phase. */
  reason:
    'Hand-written specs (the ~12 lifecycle feature specs and the 35 e2e specs) carry no requirement ' +
    'reference of any kind, and inferring one from a spec name or a Playwright tag would be an ' +
    'invented mapping. Adding a requirement annotation to those specs changes test files, which ' +
    'this phase is explicitly not permitted to do.',
  /** What a later phase would need to decide. Stated as a question, not a proposal. */
  openDecision:
    'Whether requirement references belong on the spec (an annotation per test) or on the flow ' +
    'model a later phase introduces. Choosing now would pre-commit the flow design.',
} as const;
