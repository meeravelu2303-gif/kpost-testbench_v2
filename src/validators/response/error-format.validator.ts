import { defineValidator } from '@engine/validator';
import { fromChecks, outcome, type CheckDetail } from '@engine/validation-result';
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
  appliesTo: ({ endpoint }) => {
    if (!endpoint.envelope) return 'endpoint does not use the response envelope';
    /*
     * The workbook documents no error response for KPost - no 400/401/404/409 sample anywhere.
     * Asserting an invented shape would manufacture defects; claiming a pass would be a lie. The
     * gap is reported in contracts/excel-gaps.md instead.
     */
    if (!endpoint.contract.error)
      return `${endpoint.contract.id} documents no error envelope (see contracts/excel-gaps.md)`;
    return true;
  },
  check: (context) => {
    const errorEnvelope = context.endpoint.contract.error;
    if (!errorEnvelope) return outcome.skipped('no documented error envelope');
    const checks: CheckDetail[] = errorExchanges(context).map((exchange) => {
      const parsed = exchange.json();
      const problems: string[] = [];
      if (!isJsonResponse(exchange))
        problems.push(`Content-Type ${exchange.contentType ?? '(missing)'}`);
      if (!parsed.ok) problems.push(parsed.reason);
      else {
        const result = errorEnvelope.safeParse(parsed.value);
        if (!result.success)
          problems.push(
            ...result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
          );
        const bodyStatus = getPath(parsed.value, context.endpoint.contract.errorStatusField);
        if (context.endpoint.contract.errorStatusInBody && bodyStatus !== exchange.status)
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
