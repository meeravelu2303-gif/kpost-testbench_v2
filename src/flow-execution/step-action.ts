import type { Actor } from '../actors/actor';
import type { ExecutionChannel, FlowStep } from '../flows/flow';
import type { FlowArtifact } from '../flows/artifact';
import type { FlowRun } from '../flows/flow-run';
import type { StateObservation } from '../state-observation/index';

/**
 * The execution-provider boundary (master plan §6/§7).
 *
 * ## The question this file answers
 *
 * A `FlowStep` names an endpoint id and nothing else — deliberately, so the flow layer stays above
 * the API layer and no payload, contract or selector is duplicated into a business description. But
 * an endpoint id alone cannot be executed: something must decide what to send and what the response
 * means.
 *
 * That something is a `StepAction`, registered by the caller. It is the ONLY place where a business
 * action meets execution, and it is given the EXISTING infrastructure to do the job:
 *
 *     FlowStep  →  StepAction  →  existing EndpointExecutor / endpoint definitions / UI helpers
 *
 * The engine never builds a request, never parses a response, never authenticates and never sets a
 * safety flag. It resolves the actor, checks the declared artifact dependencies, calls the action,
 * and records what came back. Everything that touches the product goes through the executor the
 * repository already has.
 *
 * ## What an action must NOT be
 *
 * Not a second endpoint executor, not a second request builder, not a second account pool, not a
 * place to keep a payload the endpoint definition already owns. An action is a thin adapter: read
 * the artifacts it needs, call `context.endpoints`, hand back what the step produced.
 */

/** One artifact a step published, paired with its value and type-checked at the call site. */
export interface ProducedArtifact {
  readonly artifact: FlowArtifact<unknown>;
  readonly value: unknown;
}

/** Type-safe pairing: `produced(MESSAGE_ID, msgID)` will not compile with the wrong value type. */
export function produced<T>(artifact: FlowArtifact<T>, value: T): ProducedArtifact {
  return { artifact, value };
}

/**
 * What an action is given.
 *
 * `endpoints` is the repository's own `EndpointExecutor`, passed through untouched, so the
 * production guard, the SMS/OTP kill-switch, the QA-identifier guard and the evidence capture all
 * apply exactly as they do to any other call. The engine adds no capability and removes none.
 */
export interface StepActionContext<TExecutor, TResources> {
  readonly step: FlowStep;
  /** The participant performing the step, resolved through this run's own `ActorContext`. */
  readonly actor: Actor;
  /** Read artifacts with `run.read` / `run.require`; never write — the engine publishes. */
  readonly run: FlowRun;
  /** The endpoint id from the binding chosen for this run, when the channel is API. */
  readonly endpointId?: string;
  readonly channel: ExecutionChannel;
  /** The existing `EndpointExecutor`. An action MUST NOT construct another. */
  readonly endpoints: TExecutor;
  /**
   * The existing `CleanupCoordinator`. An action that creates a resource registers it here, exactly
   * as today's lifecycle specs do — there is no second ledger and the engine performs no cleanup.
   */
  readonly resources: TResources;
}

/**
 * What an action reports.
 *
 * Only `PASSED` and `FAILED` — an action either ran and observed something or ran and did not.
 * `BLOCKED` and `SKIPPED` are the ENGINE's to decide, because they are statements about whether the
 * step was reached at all, which an action that is executing cannot know about itself.
 */
export interface StepActionResult {
  readonly outcome: 'PASSED' | 'FAILED';
  /** Why it failed. Required for FAILED so a report never says only "failed". */
  readonly failure?: string;
  /** Artifacts to publish. Published only when the outcome is PASSED — `FlowRun` enforces it. */
  readonly produces?: readonly ProducedArtifact[];
  /**
   * State observations captured during the step (Phase 4C). Carried, never interpreted: this layer
   * assigns no verdict to an observed value, and Phase 7 is what compares before and after.
   */
  readonly observations?: readonly StateObservation[];
  /** Correlation ids of the exchanges the action made, so evidence can be found later. */
  readonly correlationIds?: readonly string[];
}

/**
 * An executable business action, keyed by the `action` a `FlowStep` declares.
 *
 * One action may be registered per (action, channel), which is what lets the same business step be
 * driven through the API in one run and the UI in another without the flow definition changing —
 * the master plan's requirement that API and UI are channels of one flow, not two flows.
 */
export interface StepAction<TExecutor, TResources> {
  readonly action: string;
  readonly channel: ExecutionChannel;
  /** One line on what this adapter does, for the execution report. */
  readonly describe: string;
  run(
    context: StepActionContext<TExecutor, TResources>,
  ): Promise<StepActionResult> | StepActionResult;
}

export class StepActionRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StepActionRegistryError';
  }
}

/**
 * The actions available to one execution.
 *
 * Constructed per run and never module-level: two runs cannot share a registry by accident, which
 * is the same structural isolation `FlowRun` gives artifacts and `ActorContext` gives identity.
 */
export class StepActionRegistry<TExecutor, TResources> {
  private readonly actions = new Map<string, StepAction<TExecutor, TResources>>();

  private static key(action: string, channel: ExecutionChannel): string {
    return `${action}::${channel}`;
  }

  register(...actions: readonly StepAction<TExecutor, TResources>[]): this {
    for (const action of actions) {
      const key = StepActionRegistry.key(action.action, action.channel);
      const existing = this.actions.get(key);
      if (existing) {
        throw new StepActionRegistryError(
          `action "${action.action}" is already registered for channel ${action.channel} ` +
            `(${existing.describe}). Two adapters for one business action on one channel would ` +
            'make execution depend on registration order.',
        );
      }
      this.actions.set(key, action);
    }
    return this;
  }

  find(action: string, channel: ExecutionChannel): StepAction<TExecutor, TResources> | undefined {
    return this.actions.get(StepActionRegistry.key(action, channel));
  }

  /** Registered (action, channel) pairs, for a report. Deterministic order. */
  describe(): string[] {
    return [...this.actions.values()]
      .map((action) => `${action.action} [${action.channel}] — ${action.describe}`)
      .sort();
  }
}
