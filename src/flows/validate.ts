import { isActorRoleId } from '../actors/role';
import { hasRequirement } from '../requirements/index';
import type { AnyFlowArtifact } from './artifact';
import type { FlowDefinition, FlowStep } from './flow';

/**
 * Static validation of a flow definition — everything checkable without executing anything.
 *
 * Pure and total: it reads a definition and returns problems. No I/O, no clock, no randomness, and
 * no endpoint registry (endpoint ids are validated by a framework guard, which is the one place the
 * flow layer and the API layer are allowed to meet).
 *
 * ## The rule that matters most
 *
 * **A step may only consume an artifact some EARLIER step produces.** A consumer with no producer is
 * rejected outright rather than deferred to run time, because a dependency that cannot be satisfied
 * is a definition error, not a test outcome. This is what makes the `messageId` dependency a
 * checkable fact instead of a convention.
 */

export interface FlowProblem {
  flowId: string;
  /** The step the problem concerns, when it concerns one. */
  stepId?: string;
  code: FlowProblemCode;
  message: string;
}

export const FLOW_PROBLEM_CODES = [
  'DUPLICATE_STEP_ID',
  'DUPLICATE_ARTIFACT_PRODUCER',
  'MISSING_ARTIFACT_PRODUCER',
  'PRODUCER_NOT_EARLIER',
  'SELF_CONSUMPTION',
  'UNKNOWN_REQUIREMENT',
  'NO_REQUIREMENTS',
  'NO_STEPS',
  'UNDECLARED_ACTOR_ROLE',
  'UNKNOWN_ACTOR_ROLE',
  'UNBOUND_STEP_WITHOUT_REASON',
  'EMPTY_FIELD',
] as const;
export type FlowProblemCode = (typeof FLOW_PROBLEM_CODES)[number];

const artifactIds = (artifacts: readonly AnyFlowArtifact[] | undefined): string[] =>
  (artifacts ?? []).map((artifact) => artifact.artifactId);

/** Every problem with a flow definition. An empty array means the definition is well-formed. */
export function validateFlow(flow: FlowDefinition): FlowProblem[] {
  const problems: FlowProblem[] = [];
  const add = (code: FlowProblem['code'], message: string, stepId?: string): void => {
    problems.push({ flowId: flow.flowId, ...(stepId ? { stepId } : {}), code, message });
  };

  for (const [field, value] of [
    ['flowId', flow.flowId],
    ['name', flow.name],
    ['module', flow.module],
    ['description', flow.description],
  ] as const) {
    if (!value.trim()) add('EMPTY_FIELD', `${field} must not be empty`);
  }

  if (flow.requirementIds.length === 0) {
    add(
      'NO_REQUIREMENTS',
      'a flow must reference at least one requirement id — a business flow nobody requires is not a ' +
        'business flow',
    );
  }
  for (const requirementId of flow.requirementIds) {
    if (!hasRequirement(requirementId)) {
      add(
        'UNKNOWN_REQUIREMENT',
        `requirement "${requirementId}" is not in the Phase 1 registry; add it to the canonical id ` +
          'set or fix the reference — never invent a requirement here',
      );
    }
  }

  // The role type makes an invented role a compile error, but a definition built from JSON or cast
  // at a boundary never sees that check — so the registry is also consulted at run time, exactly as
  // requirement ids are above. Widened to `string` because TypeScript proves the declared type is
  // already narrow and would otherwise make the failing branch unreachable.
  for (const declared of flow.actorRoles) {
    const roleId: string = declared;
    if (!isActorRoleId(roleId)) {
      add(
        'UNKNOWN_ACTOR_ROLE',
        `actor role "${roleId}" is not in the Phase 3 role registry; add it to ` +
          'ACTOR_ROLE_DEFINITIONS with its provenance, or fix the reference — a role is never ' +
          'invented at the point of use',
      );
    }
  }

  if (flow.steps.length === 0) {
    add('NO_STEPS', 'a flow must declare at least one step');
    return problems;
  }

  // ---- step identity -------------------------------------------------------------------------
  const seenStepIds = new Set<string>();
  for (const step of flow.steps) {
    if (seenStepIds.has(step.stepId)) {
      add('DUPLICATE_STEP_ID', `step id "${step.stepId}" is declared more than once`, step.stepId);
    }
    seenStepIds.add(step.stepId);

    if (!flow.actorRoles.includes(step.actor)) {
      add(
        'UNDECLARED_ACTOR_ROLE',
        `step "${step.stepId}" names actor role "${step.actor}", which the flow does not declare in ` +
          `actorRoles [${flow.actorRoles.join(', ')}]`,
        step.stepId,
      );
    }

    if ((step.bindings?.length ?? 0) === 0 && !step.unboundReason?.trim()) {
      add(
        'UNBOUND_STEP_WITHOUT_REASON',
        `step "${step.stepId}" has no execution binding and no unboundReason. A step the repository ` +
          'cannot execute must say so explicitly, so the gap is visible rather than implied by absence',
        step.stepId,
      );
    }
  }

  // ---- artifact production -------------------------------------------------------------------
  /** artifactId → the index of the step that produces it. */
  const producedAt = new Map<string, number>();
  flow.steps.forEach((step, index) => {
    for (const id of artifactIds(step.produces)) {
      const existing = producedAt.get(id);
      if (existing !== undefined) {
        add(
          'DUPLICATE_ARTIFACT_PRODUCER',
          `artifact "${id}" is produced by both "${flow.steps[existing]?.stepId}" and ` +
            `"${step.stepId}" — one artifact has exactly one producer, so its provenance is never ambiguous`,
          step.stepId,
        );
        return;
      }
      producedAt.set(id, index);
    }
  });

  // ---- artifact consumption ------------------------------------------------------------------
  flow.steps.forEach((step, index) => {
    const produced = new Set(artifactIds(step.produces));
    for (const id of artifactIds(step.consumes)) {
      if (produced.has(id)) {
        add(
          'SELF_CONSUMPTION',
          `step "${step.stepId}" both produces and consumes artifact "${id}"`,
          step.stepId,
        );
        continue;
      }
      const producerIndex = producedAt.get(id);
      if (producerIndex === undefined) {
        add(
          'MISSING_ARTIFACT_PRODUCER',
          `step "${step.stepId}" consumes artifact "${id}", which no step produces — a dependency ` +
            'that can never be satisfied is a definition error, not a run-time outcome',
          step.stepId,
        );
        continue;
      }
      if (producerIndex >= index) {
        add(
          'PRODUCER_NOT_EARLIER',
          `step "${step.stepId}" consumes artifact "${id}", but its producer ` +
            `"${flow.steps[producerIndex]?.stepId}" is declared at or after it — a step cannot depend ` +
            'on a value that does not exist yet',
          step.stepId,
        );
      }
    }
  });

  return problems;
}

/** Throws on the first problem, listing them all. For registration, where a bad flow must not load. */
export function assertValidFlow(flow: FlowDefinition): void {
  const problems = validateFlow(flow);
  if (problems.length === 0) return;
  throw new Error(
    `flow "${flow.flowId}" is invalid:\n` +
      problems
        .map((p) => `  [${p.code}]${p.stepId ? ` ${p.stepId}:` : ''} ${p.message}`)
        .join('\n'),
  );
}

/** The steps a step depends on, derived from artifacts. Pure; used for reporting and blocking. */
export function dependenciesOf(flow: FlowDefinition, stepId: string): string[] {
  const step = flow.steps.find((candidate) => candidate.stepId === stepId);
  if (!step) return [];
  const consumed = new Set(artifactIds(step.consumes));
  return flow.steps
    .filter((candidate) => artifactIds(candidate.produces).some((id) => consumed.has(id)))
    .map((candidate) => candidate.stepId);
}

/** Steps the repository cannot execute today, with the stated reason. A measurement, not a failure. */
export function unboundSteps(flow: FlowDefinition): { step: FlowStep; reason: string }[] {
  return flow.steps
    .filter((step) => (step.bindings?.length ?? 0) === 0)
    .map((step) => ({ step, reason: step.unboundReason ?? '(no reason recorded)' }));
}
