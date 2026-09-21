/**
 * The Application Flow model — WHAT business flow is exercised.
 *
 * Phase 2B. A thin declarative layer ABOVE the existing execution and validation architecture:
 *
 *     Requirement  →  Flow  →  FlowStep  →  existing API/UI execution  →  existing validation
 *
 * ## What this layer owns
 *
 *  - the ordered business steps of a flow, and the role that performs each;
 *  - which requirement ids the flow exercises (ids only — Phase 1 owns the text);
 *  - which values one step hands to another (`FlowArtifact`), declared and type-checked;
 *  - whether a step may be treated as a business-behaviour observation at all (`FlowRun.canObserve`).
 *
 * ## What this layer does NOT own
 *
 * How a request is sent (`EndpointExecutor`), how a response is judged (the 47 validators), how
 * evidence is captured or classified (`src/failure-analysis/`), how confidence is decided, or
 * anything about Bugzilla. It imports none of them. It is not a workflow engine: it executes
 * nothing — a spec performs each step exactly as it does today and reports the outcome here.
 *
 * ## Deliberately absent
 *
 * No State model (no transitions) and no Invariant model. A flow artifact is a value handed forward,
 * never an application state.
 *
 * Phase 3 added one reference: a step's `actor` is a typed `ActorRoleId` from `src/actors/`, and a
 * `FlowRun` owns an `ActorContext` so participants are per run. Flows depend on actors; actors know
 * nothing of flows. Still no permissions anywhere.
 */

export { defineArtifact, type AnyFlowArtifact, type FlowArtifact } from './artifact';

export {
  EXECUTION_CHANNELS,
  FLOW_CLEANUP_STRATEGIES,
  FLOW_STATUSES,
  FLOW_STEP_STATUSES,
  type ExecutionChannel,
  type FlowCleanupStrategy,
  type FlowDefinition,
  type FlowStatus,
  type FlowStep,
  type FlowStepBinding,
  type FlowStepStatus,
} from './flow';

export {
  FLOW_PROBLEM_CODES,
  assertValidFlow,
  dependenciesOf,
  unboundSteps,
  validateFlow,
  type FlowProblem,
  type FlowProblemCode,
} from './validate';

export { FlowRun, FlowRunError, type BlockedReason, type FlowStepOutcome } from './flow-run';

export {
  allFlows,
  boundEndpointIds,
  flow,
  flowsForModule,
  hasFlow,
  referencedRequirementIds,
} from './registry';

export {
  KATCHUP_MESSAGE_1TO1_FLOW,
  MESSAGE_ID,
  MESSAGE_MARKER,
} from './catalogue/katchup-message-1to1';
