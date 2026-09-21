import type { Actor } from '../actors/actor';
import { ActorContext } from '../actors/context';
import type { FlowArtifact } from './artifact';
import type { FlowDefinition, FlowStepStatus } from './flow';

/**
 * The state of ONE execution of a flow: which steps ran, what they produced, and which steps are
 * consequently blocked.
 *
 * ## What this is NOT
 *
 * **Not a workflow engine.** It executes nothing, calls nothing, and knows nothing about HTTP,
 * Playwright, validators or Bugzilla. A spec (or a future adapter) performs each step using the
 * existing `EndpointExecutor` exactly as it does today, then *reports* the outcome here. This class
 * only answers two questions no existing component can answer:
 *
 *   1. is the value a later step needs actually available?
 *   2. may this step's result be treated as a business-behaviour observation at all?
 *
 * ## Why the artifact store is not a plain map
 *
 * Two rules make it structurally safe rather than a shared mutable bag:
 *
 *  - **`produce()` refuses an artifact the step did not declare.** A step cannot quietly publish a
 *    value the definition does not mention, which is what stops the store degrading into the global
 *    variable it replaces.
 *  - **A value is only stored when the step PASSED.** A failed send cannot leave a `messageId`
 *    behind for a downstream step to read, so a downstream assertion can never run on the debris of
 *    a broken upstream step.
 *
 * ## The blocking rule, and why it is not an assertion change
 *
 * A step whose consumed artifact is absent is `BLOCKED` — not failed, not passed, not silently
 * skipped. Nothing about `expect` behaviour changes anywhere; the flow layer simply refuses to call
 * a blocked step's result a business observation (`canObserve`). That is the difference between
 * "the recall assertion was vacuously true" and "the recall step never ran".
 *
 * ## Actors are per run, for the same reason artifacts are
 *
 * Each `FlowRun` owns its own `ActorContext` (Phase 3), built from the flow's declared roles. Two
 * runs of the same flow therefore have separate actors and separate account bindings, with no
 * module-level state anywhere to leak one into the other — the same structural isolation the
 * artifact store has, applied to identity.
 */

/** Why a step cannot run, naming the artifact and the step that should have produced it. */
export interface BlockedReason {
  stepId: string;
  missingArtifactId: string;
  /** The step that declares it produces the artifact, if the definition has one. */
  expectedProducerStepId?: string;
  message: string;
}

export interface FlowStepOutcome {
  stepId: string;
  status: FlowStepStatus;
  /** Present only when the step is BLOCKED. */
  blocked?: BlockedReason;
}

export class FlowRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FlowRunError';
  }
}

export class FlowRun {
  /** artifactId → value. Written only through `produce()`, and only for a PASSED step. */
  private readonly artifacts = new Map<string, unknown>();
  /** artifactId → the step that produced it, so provenance is always answerable. */
  private readonly producedBy = new Map<string, string>();
  private readonly recorded = new Map<string, FlowStepStatus>();

  /**
   * The participants of THIS run, and their account bindings.
   *
   * Constructed per run and never shared, so a second `FlowRun` inherits no actor, account or
   * binding from the first. It resolves identity only — it holds no permission and grants nothing.
   */
  readonly actors: ActorContext;

  constructor(readonly flow: FlowDefinition) {
    this.actors = new ActorContext(flow.actorRoles);
  }

  /**
   * The participant performing a step, resolved through this run's own `ActorContext`.
   *
   * Two steps naming the same role in one run yield the SAME actor, which is what makes "the sender
   * recalls the message they sent" a statement about one participant rather than two.
   */
  actorFor(stepId: string): Actor {
    return this.actors.actor(this.step(stepId).actor);
  }

  private step(stepId: string): FlowDefinition['steps'][number] {
    const found = this.flow.steps.find((candidate) => candidate.stepId === stepId);
    if (!found) {
      throw new FlowRunError(`step "${stepId}" is not part of flow "${this.flow.flowId}"`);
    }
    return found;
  }

  /**
   * Records a step's outcome.
   *
   * A step is recorded with the status its own execution produced — the flow layer never overrides
   * it. Blocking is computed for steps that have NOT been recorded, which is exactly the point: a
   * blocked step is one nobody ran.
   */
  record(stepId: string, status: FlowStepStatus): this {
    this.step(stepId);
    this.recorded.set(stepId, status);
    return this;
  }

  /**
   * Publishes an artifact produced by a step.
   *
   * Refuses when the step did not declare it (`produces`), and refuses when the step is not recorded
   * PASSED — a value only exists if the step that makes it actually succeeded.
   */
  produce<T>(stepId: string, artifact: FlowArtifact<T>, value: T): this {
    const step = this.step(stepId);
    const declared = (step.produces ?? []).some((a) => a.artifactId === artifact.artifactId);
    if (!declared) {
      throw new FlowRunError(
        `step "${stepId}" produced artifact "${artifact.artifactId}", which it does not declare. ` +
          'Add it to the step’s `produces`, or publish it from the step that owns it — a step ' +
          'may not publish a value the flow definition does not mention.',
      );
    }
    if (this.recorded.get(stepId) !== 'PASSED') {
      throw new FlowRunError(
        `step "${stepId}" cannot publish "${artifact.artifactId}" with status ` +
          `${this.recorded.get(stepId) ?? 'NOT_EXECUTED'} — record the step as PASSED first. A value ` +
          'from a step that did not succeed must never reach a downstream assertion.',
      );
    }
    this.artifacts.set(artifact.artifactId, value);
    this.producedBy.set(artifact.artifactId, stepId);
    return this;
  }

  /** Whether an artifact is available. */
  has(artifact: FlowArtifact<unknown>): boolean {
    return this.artifacts.has(artifact.artifactId);
  }

  /** An artifact's value, or `undefined`. Typed by the key — no cast at the call site. */
  read<T>(artifact: FlowArtifact<T>): T | undefined {
    return this.artifacts.get(artifact.artifactId) as T | undefined;
  }

  /** An artifact's value, or a throw naming the step that should have produced it. */
  require<T>(artifact: FlowArtifact<T>): T {
    if (!this.artifacts.has(artifact.artifactId)) {
      throw new FlowRunError(
        `artifact "${artifact.artifactId}" (${artifact.describe}) is not available — ` +
          'the step that produces it did not pass. Check `statusOf()` before requiring a value.',
      );
    }
    return this.artifacts.get(artifact.artifactId) as T;
  }

  /** Which step produced an artifact, for provenance in a report. */
  producerOf(artifact: FlowArtifact<unknown>): string | undefined {
    return this.producedBy.get(artifact.artifactId);
  }

  /**
   * The status of a step.
   *
   * A recorded status always wins. An unrecorded step is `BLOCKED` when any artifact it consumes is
   * unavailable, and `NOT_EXECUTED` otherwise.
   */
  statusOf(stepId: string): FlowStepStatus {
    const recordedStatus = this.recorded.get(stepId);
    if (recordedStatus) return recordedStatus;
    return this.blockedReason(stepId) ? 'BLOCKED' : 'NOT_EXECUTED';
  }

  /** Why a step is blocked, or `undefined` when it is not. */
  blockedReason(stepId: string): BlockedReason | undefined {
    const step = this.step(stepId);
    for (const artifact of step.consumes ?? []) {
      if (this.artifacts.has(artifact.artifactId)) continue;
      const producer = this.flow.steps.find((candidate) =>
        (candidate.produces ?? []).some((a) => a.artifactId === artifact.artifactId),
      );
      return {
        stepId,
        missingArtifactId: artifact.artifactId,
        ...(producer ? { expectedProducerStepId: producer.stepId } : {}),
        message:
          `step "${stepId}" requires artifact "${artifact.artifactId}" (${artifact.describe}), ` +
          (producer
            ? `which step "${producer.stepId}" did not produce.`
            : 'which no step produces.') +
          ' The step did not run, so its result says nothing about application behaviour.',
      };
    }
    return undefined;
  }

  /**
   * Whether this step's result may be treated as evidence about application behaviour.
   *
   * **The single most important rule in this file.** Only a step that actually ran can say anything
   * about the product. A `BLOCKED`, `NOT_EXECUTED` or `SKIPPED` step must never contribute a
   * business-behaviour observation — which is precisely how a vacuous "the recalled message is not
   * in the recipient's view" passes today when the send never happened.
   */
  canObserve(stepId: string): boolean {
    const status = this.statusOf(stepId);
    return status === 'PASSED' || status === 'FAILED';
  }

  /** Every step's outcome, in declaration order. Deterministic; safe to snapshot in a report. */
  outcomes(): FlowStepOutcome[] {
    return this.flow.steps.map((step) => {
      const status = this.statusOf(step.stepId);
      const blocked = status === 'BLOCKED' ? this.blockedReason(step.stepId) : undefined;
      return { stepId: step.stepId, status, ...(blocked ? { blocked } : {}) };
    });
  }
}
