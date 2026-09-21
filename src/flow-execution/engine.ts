import type { ExecutionChannel, FlowDefinition, FlowStep, FlowStepStatus } from '../flows/flow';
import { FlowRun, type BlockedReason } from '../flows/flow-run';
import { assertValidFlow } from '../flows/validate';
import type { StateObservation } from '../state-observation/index';
import type { StepActionRegistry } from './step-action';

/**
 * The Flow Execution Engine (master plan §8).
 *
 * ## What it does, and the much longer list of what it does not
 *
 * It walks a `FlowDefinition` in declaration order and, for each step: resolves the participant
 * through the run's own `ActorContext`, checks the step's DECLARED artifact dependencies, chooses a
 * binding for the requested channel, calls the registered `StepAction`, and records the outcome on
 * the `FlowRun`.
 *
 * It does **not** build a request, parse a response, authenticate, select an account, perform
 * cleanup, run a validator, classify a failure, or decide confidence. Every one of those already
 * has an owner in this repository, and the engine's value depends on it not acquiring a second one.
 * It holds no module-level state: an engine is constructed per execution, and two executions share
 * nothing.
 *
 * ## The rule that makes a flow result trustworthy
 *
 * A step that did not run may not contribute evidence. `FlowRun.canObserve` already states it; the
 * engine is what makes it true in practice, by refusing to call an action whose declared inputs are
 * missing:
 *
 *     send-message                 FAILED    (the send did not succeed)
 *     recipient-observes-message   BLOCKED   (consumes messageId, which was never produced)
 *     recipient-reads-message      BLOCKED   (same)
 *
 * The downstream steps are not "passed because we did not check"; they are recorded as never having
 * run, with the missing artifact and its expected producer named.
 *
 * **Blocking follows the DECLARED dependency, never step order.** A step that consumes nothing is
 * independent by definition, and the engine will run it even after an earlier failure — because
 * inventing an implicit ordering dependency would be the engine asserting a business relationship
 * the flow author never stated. An author who wants a step blocked declares what it consumes.
 *
 * ## Safety
 *
 * The engine sets no flag. `allowLiveWrite`, `ALLOW_DESTRUCTIVE_TESTS`, `WRITE_FUZZ` and the OTP
 * gateway are untouched and unreachable from here: every request an action makes goes through the
 * executor the caller injected, so the production guard, the SMS/OTP kill-switch and the
 * QA-identifier guard apply exactly as they do to any other call in the bench.
 */

/** How an execution ended, per step. Execution status only — never a failure classification. */
export interface StepExecution {
  readonly stepId: string;
  readonly action: string;
  readonly status: FlowStepStatus;
  readonly actorId?: string;
  readonly channel?: ExecutionChannel;
  readonly endpointId?: string;
  /** Why it failed, was skipped or was blocked. Present for every non-PASSED status. */
  readonly reason?: string;
  readonly blocked?: BlockedReason;
  readonly observations: readonly StateObservation[];
  readonly correlationIds: readonly string[];
  readonly durationMs: number;
  readonly producedArtifactIds: readonly string[];
}

export interface FlowExecutionResult {
  readonly flowId: string;
  readonly channel: ExecutionChannel;
  readonly run: FlowRun;
  readonly steps: readonly StepExecution[];
  readonly startedAt: string;
  readonly durationMs: number;
}

export interface FlowExecutionOptions<TExecutor, TResources> {
  readonly actions: StepActionRegistry<TExecutor, TResources>;
  readonly endpoints: TExecutor;
  readonly resources: TResources;
  /** Which channel this execution drives. A step with no binding for it is SKIPPED, never guessed. */
  readonly channel?: ExecutionChannel;
  /**
   * Recognises a refusal by one of the bench's own safety controls.
   *
   * A `ProductionSafetyError` means nothing was sent, so the step is SKIPPED with the reason rather
   * than FAILED: the bench refusing to act is not the application misbehaving. Injected rather than
   * imported so this module stays free of the validation engine — the same reason `runProbes` had
   * to learn the distinction, and the same conclusion.
   */
  readonly isSafetyRefusal?: (error: unknown) => boolean;
}

export class FlowExecutionEngine<TExecutor, TResources> {
  constructor(private readonly options: FlowExecutionOptions<TExecutor, TResources>) {}

  async execute(flow: FlowDefinition): Promise<FlowExecutionResult> {
    /*
     * An invalid flow is a DEFINITION error, not a test outcome, so it throws rather than producing
     * a result full of misleading statuses — a step naming an undeclared role or consuming an
     * artifact nothing produces would otherwise read as an application problem. Reuses the existing
     * `assertValidFlow`; the engine defines no second set of rules.
     */
    assertValidFlow(flow);
    const channel: ExecutionChannel = this.options.channel ?? 'API';
    const run = new FlowRun(flow);
    const steps: StepExecution[] = [];
    const startedAt = new Date().toISOString();
    const began = Date.now();

    for (const step of flow.steps) {
      steps.push(await this.executeStep(flow, step, run, channel));
    }

    return {
      flowId: flow.flowId,
      channel,
      run,
      steps,
      startedAt,
      durationMs: Date.now() - began,
    };
  }

  private async executeStep(
    flow: FlowDefinition,
    step: FlowStep,
    run: FlowRun,
    channel: ExecutionChannel,
  ): Promise<StepExecution> {
    const began = Date.now();
    const base = {
      stepId: step.stepId,
      action: step.action,
      observations: [] as readonly StateObservation[],
      correlationIds: [] as readonly string[],
      producedArtifactIds: [] as readonly string[],
    };
    const finish = (extra: Partial<StepExecution> & { status: FlowStepStatus }): StepExecution => ({
      ...base,
      ...extra,
      durationMs: Date.now() - began,
    });

    /*
     * Blocking is checked BEFORE anything else, including before the actor is resolved. A blocked
     * step must leave no trace of having been attempted: no account touched, no session minted, no
     * request built. It is recorded by NOT recording it — `FlowRun.statusOf` computes BLOCKED for an
     * unrecorded step whose consumed artifact is absent, which keeps one definition of the rule.
     */
    const blocked = run.blockedReason(step.stepId);
    if (blocked) {
      return finish({ status: 'BLOCKED', blocked, reason: blocked.message });
    }

    const binding = (step.bindings ?? []).find((candidate) => candidate.channel === channel);
    if (!binding) {
      const reason =
        step.unboundReason ??
        `step "${step.stepId}" has no ${channel} binding, and no unboundReason explaining why. ` +
          'A step the repository cannot execute must say so in the definition.';
      run.record(step.stepId, 'SKIPPED');
      return finish({ status: 'SKIPPED', reason, channel });
    }

    const action = this.options.actions.find(step.action, channel);
    if (!action) {
      /*
       * No adapter registered. SKIPPED, not FAILED: the application was never asked anything, so
       * there is nothing to hold it responsible for. The reason names the missing registration so
       * the gap is actionable rather than mysterious.
       */
      run.record(step.stepId, 'SKIPPED');
      return finish({
        status: 'SKIPPED',
        channel,
        ...(binding.channel === 'API' ? { endpointId: binding.endpointId } : {}),
        reason:
          `no StepAction is registered for "${step.action}" on channel ${channel}, so the step ` +
          `of flow "${flow.flowId}" could not be driven. Register an adapter, or declare the step ` +
          'unbound with a reason.',
      });
    }

    const actor = run.actorFor(step.stepId);
    const endpointId = binding.channel === 'API' ? binding.endpointId : undefined;

    let result;
    try {
      result = await action.run({
        step,
        actor,
        run,
        channel,
        ...(endpointId ? { endpointId } : {}),
        endpoints: this.options.endpoints,
        resources: this.options.resources,
      });
    } catch (error) {
      if (this.options.isSafetyRefusal?.(error)) {
        run.record(step.stepId, 'SKIPPED');
        return finish({
          status: 'SKIPPED',
          channel,
          ...(endpointId ? { endpointId } : {}),
          actorId: actor.actorId,
          reason: `refused by a bench safety control - nothing was sent (${describe(error)})`,
        });
      }
      /*
       * Any other throw is a real failure of the step. It is recorded as FAILED — not swallowed,
       * not re-thrown — so the flow continues and the DOWNSTREAM steps become BLOCKED for the
       * honest reason (their artifact was never produced) rather than the run simply stopping.
       */
      run.record(step.stepId, 'FAILED');
      return finish({
        status: 'FAILED',
        channel,
        ...(endpointId ? { endpointId } : {}),
        actorId: actor.actorId,
        reason: describe(error),
      });
    }

    run.record(step.stepId, result.outcome);

    // Artifacts are published only after a PASSED record — `FlowRun.produce` refuses otherwise, so
    // a failed step cannot leave a value behind for a later assertion to run on.
    const produced: string[] = [];
    if (result.outcome === 'PASSED') {
      for (const entry of result.produces ?? []) {
        run.produce(step.stepId, entry.artifact, entry.value);
        produced.push(entry.artifact.artifactId);
      }
    }

    return finish({
      status: result.outcome,
      channel,
      ...(endpointId ? { endpointId } : {}),
      actorId: actor.actorId,
      ...(result.outcome === 'FAILED'
        ? { reason: result.failure ?? 'the action reported FAILED without a reason' }
        : {}),
      observations: result.observations ?? [],
      correlationIds: result.correlationIds ?? [],
      producedArtifactIds: produced,
    });
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Steps whose result may be treated as evidence about the application. */
export function observableSteps(result: FlowExecutionResult): StepExecution[] {
  return result.steps.filter((step) => result.run.canObserve(step.stepId));
}

/** A one-line-per-step summary for a report. Deterministic; carries no credential. */
export function summarise(result: FlowExecutionResult): string[] {
  return result.steps.map((step) => {
    const where = step.endpointId ? ` [${step.endpointId}]` : '';
    const why = step.reason ? ` — ${step.reason}` : '';
    return `${step.status.padEnd(12)} ${step.stepId}${where}${why}`;
  });
}
