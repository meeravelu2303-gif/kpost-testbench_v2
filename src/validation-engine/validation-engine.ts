import type { ApiClientPool } from '@api/client/api-client-pool';
import type { ApiRegistry } from '@api/registry/api-registry';
import type { EndpointDefinition } from '@api/registry/endpoint-definition';
import type { BusinessRuleRegistry } from '@rules/business-rule';
import type { ValidationProfile } from '@config/constants';
import { databaseConfig } from '@config/database.config';
import { env } from '@config/env';
import { thresholds } from '@config/thresholds.config';
import type { DatabaseValidationRegistry } from '@database/database-validation';
import type { DatabasePool } from '@database/database-pool';
import type { Logger } from '@utils/logger';
import { maskSensitive, maskString } from '@utils/masking';
import { EndpointExecutor } from './endpoint-executor';
import { confirmFailure } from './reproduction-gate';
import {
  EngineValidationContext,
  type RunInfo,
  type ValidationContext,
} from './validation-context';
import {
  PROFILE_SETS,
  policyExclusion,
  resolveEndpoint,
  type ResolvedEndpoint,
} from './validation-policy';
import type { ValidationRegistry } from './validation-registry';
import {
  outcome,
  summarize,
  type ValidationReport,
  type ValidationResult,
} from './validation-result';
import { buildResult, defineValidator, STAGE_ORDER, type Validator } from './validator';

export interface ValidationEngineDeps {
  clients: ApiClientPool;
  apiRegistry: ApiRegistry;
  validators: ValidationRegistry;
  businessRules: BusinessRuleRegistry;
  databaseValidations: DatabaseValidationRegistry;
  /**
   * One client per suite, not one for the run: KPost/KMail point at the KPOST_QA test database and
   * Admin at a live production one, with different write policies. The endpoint under validation
   * decides which it gets.
   */
  databases: DatabasePool;
  log: Logger;
  /** Called with every finished report (the test fixture attaches it to the Playwright report). */
  onReport?: (report: ValidationReport) => void | Promise<void>;
}

export interface ValidateOptions {
  profile?: ValidationProfile;
}

/**
 * Orchestrates validation of one endpoint:
 * resolve definition + policy → send primary request → run every applicable validator from the
 * registry → business rules → DB validations → aggregate into one report.
 * Tests call `validate()`; they never call individual validators.
 */
export class ValidationEngine {
  constructor(private readonly deps: ValidationEngineDeps) {}

  /** Validators that run for `endpoint` under `profile`, in execution order. */
  plan(
    endpoint: string | EndpointDefinition | ResolvedEndpoint,
    profile: ValidationProfile = env.VALIDATION_PROFILE,
  ): Validator[] {
    const resolved = this.resolve(endpoint);
    return [
      ...this.deps.validators.all(),
      ...this.businessRuleValidators(resolved),
      ...this.databaseValidators(resolved),
    ]
      .filter((validator) => validator.profiles.includes(profile))
      .sort((a, b) => STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage]);
  }

  async validate(
    endpoint: string | EndpointDefinition,
    options: ValidateOptions = {},
  ): Promise<ValidationReport> {
    const resolved = this.resolve(endpoint);
    const profile = options.profile ?? env.VALIDATION_PROFILE;
    const run: RunInfo = {
      environment: env.TEST_ENV,
      build: env.BUILD_ID,
      testRunId: env.TEST_RUN_ID,
    };
    const startedAt = new Date();
    const started = performance.now();

    const executor = new EndpointExecutor(this.deps.clients, this.deps.apiRegistry, this.deps.log);
    const request = await executor.buildRequest(resolved);
    const primary = await executor.send(resolved, request, { label: 'primary' });
    const log = this.deps.log.child({
      endpoint: resolved.id,
      correlationId: primary.correlationId,
    });
    log.info(
      `${resolved.label} -> ${primary.status} (${primary.durationMs}ms), profile ${profile}`,
    );

    const results: ValidationResult[] = [];
    const context = new EngineValidationContext({
      endpoint: resolved,
      profile,
      run,
      request,
      primary,
      log,
      executor,
      results,
    });
    const blocked = new Set<string>();

    for (const validator of this.plan(resolved, profile)) {
      const result = await this.execute(validator, context, blocked);
      results.push(result);
      if (result.status === 'FAILED') log.warn(`${validator.name} FAILED: ${result.message}`);
    }

    const blocking = results.filter(
      (r) => r.status === 'FAILED' && thresholds.qualityGate.failOnSeverities.includes(r.severity),
    );
    const report: ValidationReport = {
      endpointId: resolved.id,
      endpoint: resolved.label,
      method: resolved.method,
      request: maskSensitive(request),
      requiresAuth: resolved.authentication.required,
      primary: {
        status: primary.status,
        // 2 KB is plenty to recognise an error and small enough not to bloat a ticket.
        body: maskString(primary.bodyText.slice(0, 2_048)),
      },
      tags: resolved.tags,
      suite: resolved.suite.id,
      profile,
      ...run,
      correlationId: primary.correlationId,
      startedAt: startedAt.toISOString(),
      durationMs: Math.round(performance.now() - started),
      results: maskSensitive(results),
      summary: summarize(results),
      gate: { passed: blocking.length === 0, blocking: blocking.map((r) => r.validatorName) },
    };
    await this.deps.onReport?.(report);
    return report;
  }

  private resolve(endpoint: string | EndpointDefinition | ResolvedEndpoint): ResolvedEndpoint {
    if (typeof endpoint === 'string') return resolveEndpoint(this.deps.apiRegistry.get(endpoint));
    return 'definition' in endpoint ? endpoint : resolveEndpoint(endpoint);
  }

  private async execute(
    validator: Validator,
    context: ValidationContext,
    blocked: Set<string>,
  ): Promise<ValidationResult> {
    const skip = (reason: string): ValidationResult =>
      buildResult(validator, context, outcome.skipped(reason), 0);

    const excluded = policyExclusion(validator, context.endpoint);
    if (excluded) return skip(excluded);

    for (const dependency of validator.dependsOn) {
      const prerequisite = context.resultOf(dependency);
      if (prerequisite && (prerequisite.status === 'FAILED' || blocked.has(dependency))) {
        blocked.add(validator.name);
        return skip(`prerequisite ${dependency} did not pass: ${prerequisite.message}`);
      }
    }

    const notApplicable = validator.notApplicable(context);
    if (notApplicable) return skip(notApplicable);

    /*
     * A failure is re-run before it is believed. This is the only place it can be: once the run
     * ends, the request, the token and the server state are gone, so the reporter cannot retry
     * anything. Eligibility and backoff are decided in reproduction-gate.ts; a check that recovers
     * comes back as a WARNING and is never filed.
     */
    const confirmation = await confirmFailure(validator, context, () =>
      validator.validate(context),
    );
    if (confirmation.attempts > 1) {
      context.log.info(
        `${validator.name} on ${context.endpoint.label}: ${confirmation.failures}/${confirmation.attempts} passes failed ` +
          `(${confirmation.reproduced ? 'reproduced — fileable' : 'intermittent — not filed'})`,
      );
    }
    return confirmation.result;
  }

  private businessRuleValidators(endpoint: ResolvedEndpoint): Validator[] {
    return endpoint.businessRules.map((id) => {
      const rule = this.deps.businessRules.get(id);
      return defineValidator({
        name: `business-rule.${id}`,
        category: 'BUSINESS_RULE',
        severity: rule?.severity ?? 'HIGH',
        description: rule?.description ?? `unregistered business rule "${id}"`,
        toggle: 'businessRules',
        profiles: rule?.profiles ?? PROFILE_SETS.DEEP,
        stage: 'business',
        dependsOn: rule?.dependsOn ?? [],
        check: (context) =>
          rule
            ? rule.check(context)
            : outcome.failed(
                `business rule "${id}" is not registered in src/business-rules/index.ts`,
              ),
      });
    });
  }

  private databaseValidators(endpoint: ResolvedEndpoint): Validator[] {
    /*
     * Resolved from the endpoint's own suite, so a KMail validation queries KPOST_QA and an Admin
     * one queries the Admin database under its own (write-banned) policy. Reading this from the
     * endpoint rather than from the run is what keeps the two targets from ever being confused.
     */
    const database = this.deps.databases.for(endpoint.suite.id);
    return endpoint.databaseValidations.map((id) => {
      const validation = this.deps.databaseValidations.get(id);
      return defineValidator({
        name: `database.${id}`,
        category: 'DATABASE',
        severity: validation?.severity ?? 'HIGH',
        description: validation?.description ?? `unregistered database validation "${id}"`,
        toggle: 'database',
        profiles: PROFILE_SETS.DEEP,
        stage: 'database',
        dependsOn: ['response.status-code'],
        appliesTo: () =>
          databaseConfig.enabled && database.enabled
            ? true
            : `database validation disabled for the ${endpoint.suite.id} suite ` +
              '(DB_ENABLED=false, or no connection configured for it)',
        check: (context) =>
          validation
            ? validation.check(context, database)
            : outcome.failed(
                `database validation "${id}" is not registered in src/database/validations/index.ts`,
              ),
      });
    });
  }
}
