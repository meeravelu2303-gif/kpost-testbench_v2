import type { HttpMethod, RequestSpec } from '@api/client/request-builder';
import { env } from '@config/env';
import { maskSensitive, maskString } from '@utils/masking';
import { newCorrelationId } from '@utils/correlation';
import type { ResolvedEndpoint } from './validation-policy';
import type { ValidationReport } from './validation-result';

/**
 * A 5xx seen while a gated lifecycle flow drove a real write, so it can be filed. Only a 5xx
 * counts: a server must never crash on any input, while a 4xx might be our own payload.
 */
export interface FlowFinding {
  endpoint: ResolvedEndpoint;
  method: HttpMethod;
  status: number;
  body: string;
  request: RequestSpec;
  correlationId: string;
}

/** HTTP 5xx and above — a server fault, never the caller's. */
export function isServerError(status: number): boolean {
  return status >= 500;
}

const FLOW_VALIDATOR = 'flow.server-error';

/**
 * Builds one consolidated-per-endpoint `ValidationReport` per distinct server-erroring write, so the
 * Bugzilla reporter files it exactly as it files an engine finding (same routing, dedupe, curl, gate).
 */
export function flowFindingReports(findings: readonly FlowFinding[]): ValidationReport[] {
  const byEndpoint = new Map<string, FlowFinding>();
  for (const f of findings) if (!byEndpoint.has(f.endpoint.id)) byEndpoint.set(f.endpoint.id, f);

  return [...byEndpoint.values()].map((f) => {
    const now = new Date().toISOString();
    const message =
      `write flow received HTTP ${f.status} — a server error where a 4xx (or success) belongs. ` +
      `A malformed or incomplete request must be rejected with a client error, never crash the server.`;
    return {
      endpointId: f.endpoint.id,
      endpoint: f.endpoint.label,
      method: f.method,
      request: maskSensitive(f.request),
      requiresAuth: f.endpoint.authentication.required,
      primary: { status: f.status, body: maskString(f.body.slice(0, 600)) },
      tags: f.endpoint.tags,
      suite: f.endpoint.suite.id,
      profile: env.VALIDATION_PROFILE,
      environment: env.TEST_ENV,
      build: env.BUILD_ID,
      testRunId: env.TEST_RUN_ID,
      correlationId: f.correlationId,
      startedAt: now,
      durationMs: 0,
      results: [
        {
          validationId: newCorrelationId('flow'),
          validatorName: FLOW_VALIDATOR,
          category: 'RESPONSE',
          endpointId: f.endpoint.id,
          endpoint: f.endpoint.label,
          method: f.method,
          expected: 'a client error (4xx) or success — never a 5xx',
          actual: f.status,
          status: 'FAILED',
          message,
          durationMs: 0,
          timestamp: now,
          severity: 'CRITICAL',
          correlationId: f.correlationId,
        },
      ],
      summary: { total: 1, passed: 0, failed: 1, warnings: 0, skipped: 0 },
      gate: { passed: false, blocking: [FLOW_VALIDATOR] },
    };
  });
}

/**
 * A documented business rule a gated flow confirmed violated on live (e.g. BR-C01 reschedule kept
 * the id): 2xx-but-wrong behaviour the validators cannot see. Filed through the normal pipeline.
 */
export interface BusinessRuleFinding {
  endpoint: ResolvedEndpoint;
  /** The rule id, e.g. `BR-C01`, `NFR-SEC02`, `FR-KM-005`. */
  ruleId: string;
  /** The rule as a one-sentence MUST-statement. */
  rule: string;
  expected: unknown;
  actual: unknown;
  request: RequestSpec;
  correlationId: string;
}

/** One consolidated `ValidationReport` per distinct (endpoint, rule) violation, for the reporter. */
export function businessRuleFindingReports(
  findings: readonly BusinessRuleFinding[],
): ValidationReport[] {
  const byKey = new Map<string, BusinessRuleFinding>();
  for (const f of findings) {
    const key = `${f.endpoint.id}|${f.ruleId}`;
    if (!byKey.has(key)) byKey.set(key, f);
  }
  return [...byKey.values()].map((f) => {
    const now = new Date().toISOString();
    const validator = `business-rule.${f.ruleId.toLowerCase()}`;
    return {
      endpointId: f.endpoint.id,
      endpoint: f.endpoint.label,
      method: f.endpoint.method,
      request: maskSensitive(f.request),
      requiresAuth: f.endpoint.authentication.required,
      tags: f.endpoint.tags,
      suite: f.endpoint.suite.id,
      profile: env.VALIDATION_PROFILE,
      environment: env.TEST_ENV,
      build: env.BUILD_ID,
      testRunId: env.TEST_RUN_ID,
      correlationId: f.correlationId,
      startedAt: now,
      durationMs: 0,
      results: [
        {
          validationId: newCorrelationId('br'),
          validatorName: validator,
          category: 'BUSINESS_RULE',
          endpointId: f.endpoint.id,
          endpoint: f.endpoint.label,
          method: f.endpoint.method,
          expected: f.expected,
          actual: f.actual,
          status: 'FAILED',
          message: `${f.ruleId} violated — ${f.rule}`,
          durationMs: 0,
          timestamp: now,
          severity: 'HIGH',
          correlationId: f.correlationId,
        },
      ],
      summary: { total: 1, passed: 0, failed: 1, warnings: 0, skipped: 0 },
      gate: { passed: false, blocking: [validator] },
    };
  });
}
