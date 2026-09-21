import { KATCHUP_MESSAGE_1TO1_FLOW } from './catalogue/katchup-message-1to1';
import type { FlowDefinition } from './flow';
import { assertValidFlow } from './validate';

/**
 * The registered application flows.
 *
 * Mirrors the shape the repository already uses for endpoints (`ApiRegistry`) and requirements
 * (Phase 1): a single module-level registry, built once at import, **validated at import** so a
 * malformed flow fails loudly at load rather than mid-run. `ApiRegistry.register` does the same for
 * endpoints, and `workbookContract()` does it for contracts.
 *
 * One flow is registered in Phase 2B. That is deliberate: the objective is architectural proof, not
 * coverage.
 */

const FLOWS: readonly FlowDefinition[] = [KATCHUP_MESSAGE_1TO1_FLOW];

// Fail at import, never at run time — the same discipline as the endpoint factory's contract lookup.
for (const flow of FLOWS) assertValidFlow(flow);

const BY_ID = new Map(FLOWS.map((flow) => [flow.flowId, flow]));

if (BY_ID.size !== FLOWS.length) {
  throw new Error('duplicate flowId in the flow registry');
}

/** Every registered flow. */
export function allFlows(): readonly FlowDefinition[] {
  return FLOWS;
}

/** One flow by id, or `undefined`. */
export function flow(flowId: string): FlowDefinition | undefined {
  return BY_ID.get(flowId);
}

/** Whether a flow is registered. */
export function hasFlow(flowId: string): boolean {
  return BY_ID.has(flowId);
}

/** Flows belonging to one module. */
export function flowsForModule(module: string): FlowDefinition[] {
  return FLOWS.filter((candidate) => candidate.module === module);
}

/** Every endpoint id any flow binds to, so a guard can resolve them against the endpoint registry. */
export function boundEndpointIds(): string[] {
  const ids = new Set<string>();
  for (const candidate of FLOWS) {
    for (const step of candidate.steps) {
      for (const binding of step.bindings ?? []) {
        if (binding.channel === 'API') ids.add(binding.endpointId);
      }
    }
  }
  return [...ids].sort();
}

/** Every requirement id any flow references, for traceability reporting. */
export function referencedRequirementIds(): string[] {
  return [...new Set(FLOWS.flatMap((candidate) => candidate.requirementIds))].sort();
}
