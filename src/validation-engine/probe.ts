import type { RequestSpec } from '@api/client/request-builder';
import type { ApiResponseWrapper } from '@api/client/response-wrapper';
import type { AuthMode } from './endpoint-executor';
import type { ValidationContext } from './validation-context';
import { fromChecks, type CheckDetail, type ValidationOutcome } from './validation-result';

/** One extra request a validator sends, with the status it expects back. */
export interface ProbeCase {
  name: string;
  spec: RequestSpec;
  auth?: AuthMode;
  /** Accepted statuses. Omitted: any non-5xx response is acceptable. */
  expectedStatus?: readonly number[];
  /** Extra assertion on the exchange; return a failure message or undefined. */
  assert?: (exchange: ApiResponseWrapper) => string | undefined;
}

export function statusMatches(status: number, expected?: readonly number[]): boolean {
  return expected ? expected.includes(status) : status > 0 && status < 500;
}

/**
 * The only place that sends a probe and compares its status — shared by the authentication,
 * authorization, request and security validators.
 */
export async function runProbes(
  context: ValidationContext,
  labelPrefix: string,
  cases: readonly ProbeCase[],
  subject: string,
): Promise<ValidationOutcome> {
  const checks: CheckDetail[] = [];
  for (const probe of cases) {
    const exchange = await context.send(probe.spec, {
      label: `${labelPrefix}:${probe.name}`,
      auth: probe.auth,
    });
    const statusOk = statusMatches(exchange.status, probe.expectedStatus);
    const problem = statusOk ? probe.assert?.(exchange) : exchange.transportError?.message;
    checks.push({
      name: probe.name,
      status: !statusOk || problem ? 'FAILED' : 'PASSED',
      expected: probe.expectedStatus ?? 'any status < 500',
      actual: exchange.status,
      message: problem,
      correlationId: exchange.correlationId,
    });
  }
  return fromChecks(checks, subject);
}
