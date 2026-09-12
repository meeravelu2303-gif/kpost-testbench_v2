import { errorEnvelopeSchema } from '@config/api.config';
import { defineValidator } from '@engine/validator';
import { fromChecks, type CheckDetail } from '@engine/validation-result';
import { getPath } from '@utils/json';
import { errorExchanges, isJsonResponse } from '../support';

/**
 * Runs after all probes, so every 4xx/5xx produced anywhere in the run (auth, authz, invalid
 * payloads, business rules' probes) is checked against the one error contract.
 */
export const errorFormatValidator = defineValidator({
  name: 'response.error-format',
  category: 'RESPONSE',
  severity: 'HIGH',
  description: 'Every error response uses the standard error envelope with a matching status',
  toggle: 'errorFormat',
  stage: 'aggregate',
  appliesTo: ({ endpoint }) =>
    endpoint.envelope ? true : 'endpoint does not use the response envelope',
  check: (context) => {
    const checks: CheckDetail[] = errorExchanges(context).map((exchange) => {
      const parsed = exchange.json();
      const problems: string[] = [];
      if (!isJsonResponse(exchange))
        problems.push(`Content-Type ${exchange.contentType ?? '(missing)'}`);
      if (!parsed.ok) problems.push(parsed.reason);
      else {
        const result = errorEnvelopeSchema.safeParse(parsed.value);
        if (!result.success)
          problems.push(
            ...result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
          );
        const bodyStatus = getPath(parsed.value, 'status');
        if (bodyStatus !== exchange.status)
          problems.push(`body status ${String(bodyStatus)} != HTTP ${exchange.status}`);
      }
      return {
        name: exchange.label,
        status: problems.length ? 'FAILED' : 'PASSED',
        expected: 'standard error envelope',
        actual: exchange.status,
        message: problems.length ? problems.join('; ') : undefined,
        correlationId: exchange.correlationId,
      };
    });
    return fromChecks(checks, 'error responses', 'no error responses observed in this run');
  },
});
