import type { ExchangePhase } from '@engine/endpoint-executor';
import type { ActorRoleId } from '../actors/role';
import type { AnyFlowArtifact } from './artifact';

/**
 * The Application Flow model — WHAT business flow is exercised, never HOW it is executed.
 *
 * Phase 2B. This module holds types and vocabulary only. It contains no HTTP, no Playwright, no
 * validation and no defect logic, and it imports nothing from the validators, the reporters, the
 * confidence gate or the bug tracker. Execution stays where it already is: `EndpointExecutor` sends
 * requests, the validators judge responses, the evidence/observation/confidence layers explain them.
 *
 *     Requirement  →  Flow  →  FlowStep  →  existing API/UI execution  →  existing validation
 *
 * ## The boundary this file defends
 *
 * A `FlowDefinition` is **declarative data**. It deliberately has no field that can hold a callback,
 * a Playwright locator or a request payload — the brief's "do not turn flow definitions into giant
 * test scripts" is enforced by the shape of the type, not by discipline. A step names a business
 * action and, optionally, which endpoint realises it on a given channel; resolving that name to an
 * actual call is the adapter's job, in the execution layer.
 *
 * ## What is deliberately NOT modelled here
 *
 * No State model (no transitions, no object lifecycle) and no Invariant model. Phase 2A established
 * that carrying unvalidatable ids for those layers would be an invented mapping.
 *
 * Phase 3 added the one exception: a step's `actor` is now a typed `ActorRoleId` from
 * `src/actors/role.ts` instead of an arbitrary string, so a role cannot be invented or misspelled in
 * a flow definition. That is a **reference** to the role vocabulary and nothing more — this module
 * still binds no account, holds no session and knows nothing about permissions. Flows depend on
 * actors; actors know nothing of flows, so the direction stays one-way.
 */

/**
 * Which surface realises a step.
 *
 * A channel is a property of EXECUTION, not of the business flow: `katchup.send-message` is one
 * business action whether a person clicks Send or the bench posts JSON. This is why the model has a
 * single `FlowDefinition` per business flow and never a `KatchupApiFlow` / `KatchupUiFlow` pair.
 */
export const EXECUTION_CHANNELS = ['API', 'UI'] as const;
export type ExecutionChannel = (typeof EXECUTION_CHANNELS)[number];

/**
 * How one step is realised on one channel.
 *
 * `API` bindings name a registered endpoint id — a string, deliberately, so this module never
 * imports the endpoint registry and the flow layer stays above the API layer. A framework guard
 * resolves those ids against `apiRegistry`, which is where the two are allowed to meet.
 *
 * `UI` bindings name a helper in the existing UI support library rather than embedding selectors,
 * for the same reason.
 */
export type FlowStepBinding =
  { channel: 'API'; endpointId: string } | { channel: 'UI'; helper: string };

/**
 * The EXECUTION status of a step within one run of a flow.
 *
 * ## This is not a failure classification, and must never be read as one
 *
 * Two different questions exist in this repository and Phase 2C separates them explicitly:
 *
 *     execution status        did this step run, and what happened when it did?
 *                             NOT_EXECUTED | BLOCKED | SKIPPED | PASSED | FAILED   (this type)
 *
 *     failure classification  WHY did a failure occur, and who is responsible?
 *                             APP_DEFECT | TEST_ISSUE | ENVIRONMENT | …            (Phase 3.3)
 *
 * `BLOCKED` here means **only** "the step did not run, because a value it declared it consumes was
 * never produced". It carries no cause, no attribution and no blame. In particular it does **not**
 * mean the Phase 3.3 `PRECONDITION_FAILED` reason code: that code is a conclusion the classifier
 * reaches from evidence about a *failed setup exchange*, whereas a blocked flow step has no
 * evidence at all — nothing was sent, so there is nothing to classify.
 *
 * The two vocabularies both happen to contain the word `BLOCKED`. That is a coincidence of English,
 * not a mapping: this module imports nothing from `src/failure-analysis/`, defines its own closed
 * set below, and a guard in `tests/framework/flow-model.spec.ts` asserts no flow type carries a
 * classification field. Anything that later wants to classify a flow outcome must do so through the
 * existing classifier, from evidence — never by translating this enum.
 *
 * Where the member names coincide with `ValidationStatus`
 * (`src/validation-engine/validation-result.ts:6`), the meaning is the same — `PASSED`, `FAILED` and
 * `SKIPPED` are reused deliberately so the repository has one word per idea. `NOT_EXECUTED` is the
 * initial state, distinct from `SKIPPED` (a deliberate decision not to run) and from `BLOCKED`
 * (unable to run).
 *
 * The distinction that matters: **only `PASSED` and `FAILED` mean the step actually ran**, and only
 * those may produce a business-behaviour observation. See `FlowRun.canObserve`.
 */
export const FLOW_STEP_STATUSES = [
  'NOT_EXECUTED',
  'BLOCKED',
  'SKIPPED',
  'PASSED',
  'FAILED',
] as const;
export type FlowStepStatus = (typeof FLOW_STEP_STATUSES)[number];

/**
 * One business step.
 *
 * `actor` names a registered `ActorRoleId`. It identifies WHO performs the step and nothing else: no
 * account, no session, no permission. Resolving the role to a participant is `ActorContext`'s job,
 * per run, and binding that participant to an account is the execution layer's.
 */
export interface FlowStep {
  /** Unique within the flow. Used in declarations, blocked reasons and artifact provenance. */
  stepId: string;
  name: string;
  /** A registered role id — see the note above. Never a free string, never a permission. */
  actor: ActorRoleId;
  /**
   * The channel-independent business action, e.g. `katchup.send-message`. One action, many possible
   * bindings; the flow never says which channel is used at run time.
   */
  action: string;
  /**
   * Reuses the engine's own `ExchangePhase` (`precondition | action | cleanup`) rather than
   * inventing a step-kind vocabulary. `precondition` is declared in the engine today and never set
   * by production code, so flows are its first real consumer.
   */
  phase: ExchangePhase;
  /** Artifacts this step makes available to later steps. */
  produces?: readonly AnyFlowArtifact[];
  /** Artifacts this step needs. A missing one blocks the step — it does not fail it. */
  consumes?: readonly AnyFlowArtifact[];
  /**
   * How the step is realised, per channel. An EMPTY or absent list means the repository has no way
   * to execute this step today — recorded honestly rather than omitted, so the gap is visible to a
   * guard instead of being invisible by absence.
   */
  bindings?: readonly FlowStepBinding[];
  /** Why a step has no binding, when it has none. Required by the validator in that case. */
  unboundReason?: string;
}

/**
 * How the resources a flow creates are removed.
 *
 * Reuses the vocabulary already in `config/run-profiles.json` (`spec-managed`, `not-applicable`)
 * and adds the one the resource ledger implements (`ledger-managed`) — the flow REFERENCES a
 * strategy, it never performs cleanup. `CleanupCoordinator` remains solely responsible.
 */
export const FLOW_CLEANUP_STRATEGIES = [
  'ledger-managed',
  'spec-managed',
  'not-applicable',
] as const;
export type FlowCleanupStrategy = (typeof FLOW_CLEANUP_STRATEGIES)[number];

/** Whether the flow is ready to be executed, and why not when it is not. */
export const FLOW_STATUSES = ['ACTIVE', 'DRAFT'] as const;
export type FlowStatus = (typeof FLOW_STATUSES)[number];

export interface FlowDefinition {
  /** Stable id, e.g. `katchup.message-1to1-lifecycle`. */
  flowId: string;
  name: string;
  /** The existing module vocabulary (`katchup`, `kall`, …). */
  module: string;
  /**
   * Requirement ids from the Phase 1 registry. **Ids only** — requirement text is never copied, and
   * a framework guard asserts every id resolves through `hasRequirement()`.
   */
  requirementIds: readonly string[];
  /**
   * The roles this flow needs, as registered role ids. Declarations only — a flow states who takes
   * part, never what they may do, and binds no account.
   */
  actorRoles: readonly ActorRoleId[];
  /** Ordered. Order is the declared business sequence, and the validator enforces it. */
  steps: readonly FlowStep[];
  cleanupStrategy: FlowCleanupStrategy;
  status: FlowStatus;
  /** One line on what the flow is for, and anything a reader must know before trusting it. */
  description: string;
}
