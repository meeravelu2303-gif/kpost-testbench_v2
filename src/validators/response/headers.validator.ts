import { apiConfig } from '@config/api.config';
import { defineValidator } from '@engine/validator';
import { fromChecks, type CheckDetail } from '@engine/validation-result';

export const headersValidator = defineValidator({
  name: 'response.headers',
  category: 'RESPONSE',
  severity: 'MEDIUM',
  description: 'Required response headers are present and the correlation ID is echoed',
  toggle: 'headers',
  check: ({ primary, endpoint }) => {
    const checks: CheckDetail[] = endpoint.requiredHeaders.map((name) => {
      const value = primary.header(name);
      return {
        name,
        status: value ? 'PASSED' : 'FAILED',
        expected: 'present',
        actual: value ?? '(missing)',
      };
    });
    const echoed = primary.header(apiConfig.correlationHeader);
    checks.push({
      name: `${apiConfig.correlationHeader} echo`,
      status: echoed === primary.correlationId ? 'PASSED' : 'FAILED',
      expected: primary.correlationId,
      actual: echoed ?? '(missing)',
    });
    return fromChecks(checks, 'header checks');
  },
});
