import { apiConfig } from '@config/api.config';
import type { HttpMethod, RequestSpec } from '@api/client/request-builder';
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
  /** Deliberately call the endpoint with a verb it does not implement. */
  method?: HttpMethod;
  /** Deliberately send a media type the endpoint does not accept. */
  contentType?: string;
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
      method: probe.method,
      contentType: probe.contentType,
    });
    const statusOk = statusMatches(exchange.status, probe.expectedStatus);
    const problem = statusOk ? probe.assert?.(exchange) : exchange.transportError?.message;
    /*
     * A throttled probe taught us nothing.
     *
     * Some endpoints rate-limit (adminUserLogin, uniqueNameExist), and a run that sends a dozen
     * negative probes trips them. The 429 is the bench's own doing: reporting it as a failed
     * error-shape check would blame the API for the load we generated, and reporting it as a pass
     * would claim we verified something we never saw. So it is SKIPPED with the reason - unless
     * 429 is itself the expected status, which is what the rate-limit validator asserts.
     */
    const throttled =
      exchange.status === apiConfig.rateLimitStatus &&
      !probe.expectedStatus?.includes(apiConfig.rateLimitStatus);
    const failed = !throttled && (!statusOk || Boolean(problem));
    checks.push({
      name: probe.name,
      status: throttled ? 'SKIPPED' : failed ? 'FAILED' : 'PASSED',
      expected: probe.expectedStatus ?? 'any status < 500',
      actual: exchange.status,
      message: throttled
        ? `rate limited (HTTP ${exchange.status}) - inconclusive, the bench caused it`
        : problem,
      correlationId: exchange.correlationId,
      // Only on a failure: this is what a bug report needs to be reproducible.
      ...(failed ? { request: probe.spec } : {}),
    });
  }
  return fromChecks(checks, subject);
}
