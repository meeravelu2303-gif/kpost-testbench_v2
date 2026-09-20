import type { HttpMethod, RequestSpec } from '@api/client/request-builder';
import { env } from '@config/env';
import { maskSensitive, maskString } from '@utils/masking';
import { newCorrelationId } from '@utils/correlation';
import type { ResolvedEndpoint } from './validation-policy';
import type { ValidationReport } from './validation-result';

/**
 * A server error observed while a gated lifecycle flow drove a real write.
 *
 * Why this exists: the lifecycle feature specs (`*_LIFECYCLE`) drive writes the engine never touches,
 * and they FIND real bugs (a 5xx on `employeeDetails/save`, on the scheduled-call endpoints, …). But
 * those specs use raw `helpers.call()` + `expect.soft`, so their failures were only test failures —
 * they never reached Bugzilla, and a bug the developer never sees is a bug that never gets fixed.
 *
 * The safe, narrow rule for turning a flow failure into a ticket: **only a `5xx` counts.** A server
 * that crashes is the developer's defect no matter what we sent — even a malformed or incomplete
 * request must be answered with a 4xx, never a 500. A `4xx` might be OUR payload (the contamination
 * risk), and a bench/sequencing failure is our fault, so neither is filed. That keeps the
 * "no false bugs" guarantee while making genuine write crashes visible to the developer.
 */
export interface FlowFinding {
  endpoint: ResolvedEndpoint;
  method: HttpMethod;
  status: number;
  body: string;
  request: RequestSpec;
  correlationId: string;
}

/**
 * A server error observed while the framework was CLEANING UP, not while the test was acting.
 *
 * Phase 3 §12. It is deliberately a different type from `FlowFinding`, and deliberately has **no**
 * `…Reports()` converter: a `FlowFinding` becomes a `ValidationReport` and travels the whole Bugzilla
 * pipeline, and a teardown delete must never do that. Two reasons, both measured:
 *
 *  - a cleanup call runs AFTER the test's assertions, so its response says nothing about the
 *    behaviour under test — `testStatus` and `cleanupStatus` are independent dimensions (Phase 2.5),
 *    and folding a teardown 5xx into the functional pipeline collapses them; and
 *  - cleanup runs last, when the environment is most likely to be mid-teardown, session-displaced or
 *    rate-limited, so it is the weakest possible evidence of an application defect.
 *
 * It is NOT suppression. The record is kept, surfaced on the `cleanup-summary` attachment and
 * annotated on the test, so a failing teardown stays visible — it simply stays on the cleanup
 * dimension instead of becoming a product defect. Deciding whether one of these IS a defect needs the
 * evidence and classification work of Phase 3.2+, and needs a test that exercises the delete as its
 * ACTION rather than as a side effect.
 */
export interface CleanupServerError {
  /** Endpoint id, e.g. `katchup-delete-message`. */
  endpointId: string;
  /** `METHOD /path`, for the report. */
  endpoint: string;
  method: HttpMethod;
  status: number;
  /** The `SendOptions.label` of the call, e.g. `feature:cleanup`. */
  label: string;
  correlationId: string;
  /** Truncated and masked — this is reported, so it must be safe to read. */
  body: string;
}

/** HTTP 5xx and above — a server fault, never the caller's. */
export function isServerError(status: number): boolean {
  return status >= 500;
}

/** Keeps a cleanup body short and safe; it is attached to the test, so it must never carry a secret. */
export function describeCleanupBody(body: string): string {
  return maskString(body.slice(0, 300));
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
 * A documented BUSINESS RULE a gated flow found violated on live — the product's logic, not a crash or
 * a schema fault: reschedule created a new id instead of keeping it (BR-C01), a recalled message stayed
 * visible (BR-K03), a confidential copy leaked (NFR-SEC02), an existing id was reported available
 * (BR-S02), … These are 2xx-but-wrong-behaviour defects the engine's validators cannot see; a feature
 * spec detects them by comparing the RESPONSE/state to the rule, and records one here ONLY when it is a
 * CONFIRMED violation (never a bench/selector/sequencing failure — that stays a plain test failure).
 * It then files through the same safe pipeline as any finding (product-scoped dedupe, validity gate,
 * routed to the module's developer).
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
