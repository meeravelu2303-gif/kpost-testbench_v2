import { randomUUID } from 'node:crypto';
import { VALIDATION_PROFILES, type ValidationProfile } from '@config/constants';
import { apiTestCaseId } from '@reporting/test-case-id';
import type { ValidationContext } from './validation-context';
import type { ValidationToggle } from './validation-policy';
import type {
  Severity,
  ValidationCategory,
  ValidationOutcome,
  ValidationResult,
} from './validation-result';

/**
 * Execution order. `primary` validators read the happy-path exchange, `probe` validators send
 * extra requests, `aggregate` validators inspect every exchange collected so far.
 */
export type ValidationStage = 'primary' | 'database' | 'probe' | 'aggregate' | 'business';
export const STAGE_ORDER: Record<ValidationStage, number> = {
  primary: 0,
  database: 1,
  probe: 2,
  aggregate: 3,
  business: 4,
};

/** The contract every centralized validator implements. */
export interface Validator<TContext extends ValidationContext = ValidationContext> {
  /** Unique, stable name: `<category>.<check>`, e.g. `response.status-code`. */
  readonly name: string;
  readonly category: ValidationCategory;
  readonly severity: Severity;
  readonly description: string;
  /** Policy switch that enables/disables this validator per endpoint. */
  readonly toggle: ValidationToggle;
  /** Profiles in which this validator runs. */
  readonly profiles: readonly ValidationProfile[];
  readonly stage: ValidationStage;
  /** Validators that must not have FAILED for this one to run. */
  readonly dependsOn: readonly string[];
  /** Reason the validator does not apply to this endpoint, or undefined when it applies. */
  notApplicable(context: TContext): string | undefined;
  validate(context: TContext): Promise<ValidationResult>;
}

export interface ValidatorSpec<TContext extends ValidationContext = ValidationContext> {
  name: string;
  category: ValidationCategory;
  severity: Severity;
  description: string;
  toggle: ValidationToggle;
  /** Default: every profile. */
  profiles?: readonly ValidationProfile[];
  /** Default: `primary`. */
  stage?: ValidationStage;
  dependsOn?: readonly string[];
  /** Return `true` when applicable, otherwise the skip reason. */
  appliesTo?(context: TContext): true | string;
  check(context: TContext): ValidationOutcome | Promise<ValidationOutcome>;
}

type ResultMeta = Pick<Validator, 'name' | 'category' | 'severity'>;

export function buildResult(
  meta: ResultMeta,
  context: ValidationContext,
  result: ValidationOutcome,
  durationMs: number,
): ValidationResult {
  return {
    validationId: randomUUID(),
    // The stable identity of the CHECK, alongside (never replacing) this execution's validationId.
    testCaseId: apiTestCaseId({
      suiteId: context.endpoint.suite.id,
      endpointId: context.endpoint.id,
      validatorName: meta.name,
    }),
    validatorName: meta.name,
    category: meta.category,
    endpointId: context.endpoint.id,
    endpoint: context.endpoint.label,
    method: context.endpoint.method,
    expected: result.expected,
    actual: result.actual,
    status: result.status,
    message: result.message,
    durationMs,
    timestamp: new Date().toISOString(),
    severity: meta.severity,
    error: result.error,
    correlationId: result.correlationId ?? context.correlationId,
    details: result.details,
  };
}

/**
 * Builds a Validator from a spec. Timing, error capture and result construction happen here,
 * once, so validators only implement `check()` and cannot return a non-standard format.
 */
export function defineValidator<TContext extends ValidationContext = ValidationContext>(
  spec: ValidatorSpec<TContext>,
): Validator<TContext> {
  return {
    name: spec.name,
    category: spec.category,
    severity: spec.severity,
    description: spec.description,
    toggle: spec.toggle,
    profiles: spec.profiles ?? VALIDATION_PROFILES,
    stage: spec.stage ?? 'primary',
    dependsOn: spec.dependsOn ?? [],

    notApplicable(context) {
      const applicability = spec.appliesTo?.(context) ?? true;
      return applicability === true ? undefined : applicability;
    },

    async validate(context) {
      const started = performance.now();
      let result: ValidationOutcome;
      try {
        result = await spec.check(context);
      } catch (error) {
        const { name, message } = error as Error;
        result = {
          status: 'FAILED',
          message: `validator error: ${message}`,
          error: { name, message },
        };
      }
      return buildResult(spec, context, result, Math.round(performance.now() - started));
    },
  };
}
