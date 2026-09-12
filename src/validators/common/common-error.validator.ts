import { apiConfig } from '@config/api.config';
import { defineValidator } from '@engine/validator';
import { fromChecks, type CheckDetail } from '@engine/validation-result';
import { getPath } from '@utils/json';
import { errorExchanges } from '../support';

/**
 * Error *semantics* across the run (the error-format validator covers structure):
 * no request the framework sends may cause a 5xx, and well-known statuses use their
 * platform error code (401 UNAUTHORIZED, 403 FORBIDDEN, 404 NOT_FOUND, ...).
 */
export const commonErrorValidator = defineValidator({
  name: 'common.api-error',
  category: 'COMMON_DATA',
  severity: 'HIGH',
  description: 'No 5xx responses, and error codes match their HTTP status',
  toggle: 'errorFormat',
  stage: 'aggregate',
  check: (context) => {
    const checks: CheckDetail[] = errorExchanges(context).map((exchange) => {
      const parsed = exchange.json();
      /*
       * An API without an error-code field (KPost) is checked for 5xx only. Asserting a code it
       * never promised would fail every error response and bury the real finding.
       */
      const codeField = context.endpoint.contract.errorCodeField;
      const code = codeField && parsed.ok ? getPath(parsed.value, codeField) : undefined;
      const expectedCode = codeField ? apiConfig.errorCodeByStatus[exchange.status] : undefined;
      const problem =
        exchange.status >= 500
          ? `server error ${exchange.status}`
          : expectedCode && code !== expectedCode
            ? `code ${String(code)}, expected ${expectedCode}`
            : undefined;
      return {
        name: exchange.label,
        status: problem ? 'FAILED' : 'PASSED',
        expected: expectedCode ?? 'status < 500',
        actual: { status: exchange.status, code },
        message: problem,
        correlationId: exchange.correlationId,
      };
    });
    return fromChecks(checks, 'error responses', 'no error responses observed in this run');
  },
});
