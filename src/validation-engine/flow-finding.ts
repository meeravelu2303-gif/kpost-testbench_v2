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
