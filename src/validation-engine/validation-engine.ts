import type { ApiClientPool } from '@api/client/api-client-pool';
import type { ApiRegistry } from '@api/registry/api-registry';
import type { EndpointDefinition } from '@api/registry/endpoint-definition';
import type { BusinessRuleRegistry } from '@rules/business-rule';
import type { ValidationProfile } from '@config/constants';
import { databaseConfig } from '@config/database.config';
import { env } from '@config/env';
import { thresholds } from '@config/thresholds.config';
import type { DatabaseClient } from '@database/database-client';
import type { DatabaseValidationRegistry } from '@database/database-validation';
import type { Logger } from '@utils/logger';
import { maskSensitive, maskString } from '@utils/masking';
import { reachabilityOf, type ExchangeEvidence } from '../failure-analysis/index';
import { apiTestCaseId } from '@reporting/test-case-id';
import { EndpointExecutor } from './endpoint-executor';
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
  database: DatabaseClient;
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

    const planned = this.plan(resolved, profile);
    for (const validator of planned) {
      /*
       * Attribute the exchanges this validator is about to make to ITS stable case id (Phase 2.2) —
       * the same id `buildResult` stamps on the result, derived by the same function, never invented.
       *
       * The PRIMARY exchange above is deliberately left unattributed: it is sent once and shared by
       * every validator for this endpoint, so naming any one of their test cases as its owner would
       * be a fiction. Legitimately-unassociated traffic is recorded as such.
       */
      executor.forTestCase(
        apiTestCaseId({
          suiteId: resolved.suite.id,
          endpointId: resolved.id,
          validatorName: validator.name,
        }),
      );
      const result = await this.execute(validator, context, blocked);
      results.push(result);
      if (result.status === 'FAILED') log.warn(`${validator.name} FAILED: ${result.message}`);
    }
    // A validator outside the active profile is RECORDED as skipped, never silently omitted — so
    // the report states "injection: not in profile REGRESSION" instead of not mentioning it.
    for (const validator of this.deps.validators.all()) {
      if (planned.includes(validator)) continue;
      results.push(
        buildResult(
          validator,
          context,
          outcome.skipped(
            `not in validation profile ${profile} (runs in ${validator.profiles.join('/')})`,
          ),
          0,
        ),
      );
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
      /*
       * Phase 3.2 — observational only. Kept bounded by carrying the PRIMARY exchange (the
       * reachability witness) plus only the exchanges a FAILED check actually judged, matched by
       * correlation id. A green endpoint's probe evidence is of no use to a later classifier and
       * would multiply a full run's report size for nothing.
       */
      evidence: selectEvidence(executor.exchangeEvidence, results),
      reachability: reachabilityOf(executor.exchangeEvidence),
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

    return validator.validate(context);
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
          databaseConfig.enabled && this.deps.database.enabled
            ? true
            : 'database validation disabled (DB_ENABLED=false or no database client configured)',
        check: (context) =>
          validation
            ? validation.check(context, this.deps.database)
            : outcome.failed(
                `database validation "${id}" is not registered in src/database/validations/index.ts`,
              ),
      });
    });
  }
}

/**
 * The evidence worth carrying on a report: the PRIMARY exchange, plus every exchange a FAILED check
 * judged, matched by correlation id.
 *
 * The primary is always kept because it is the reachability witness — the contrast that lets a later
 * phase tell "this endpoint answers, but this one probe did not reach it" from "nothing here
 * answers". Everything else is kept only when a failure actually referenced it, which keeps a green
 * run's reports the size they are today.
 */
function selectEvidence(
  evidence: readonly ExchangeEvidence[],
  results: readonly ValidationResult[],
): ExchangeEvidence[] {
  const referenced = new Set<string>();
  for (const result of results) {
    if (result.status !== 'FAILED') continue;
    referenced.add(result.correlationId);
    for (const detail of result.details ?? []) {
      if (detail.status === 'FAILED' && detail.correlationId) referenced.add(detail.correlationId);
    }
  }
  return evidence.filter((record) => record.primary || referenced.has(record.correlationId));
}
