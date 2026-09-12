import { apiConfig } from '@config/api.config';
import { PROFILE_SETS } from '@engine/validation-policy';
import { defineValidator } from '@engine/validator';
import { fromChecks, type CheckDetail } from '@engine/validation-result';
import { getPath } from '@utils/json';
import { requiresRoleCheck } from './support';

/** Inspects the denials produced by the permission validator: no data leak, correct error code. */
export const forbiddenValidator = defineValidator({
  name: 'authorization.forbidden',
  category: 'AUTHORIZATION',
  severity: 'HIGH',
  description: 'Forbidden responses expose no resource data and use the FORBIDDEN error code',
  toggle: 'authorization',
  profiles: PROFILE_SETS.DEEP_AND_SECURITY,
  stage: 'aggregate',
  dependsOn: ['authorization.permission'],
  appliesTo: requiresRoleCheck,
  check: (context) => {
    const expectedCode = apiConfig.errorCodeByStatus[403];
    const checks: CheckDetail[] = context.exchanges
      .filter((exchange) => exchange.label.startsWith('authorization.permission:'))
      .map((exchange) => {
        const parsed = exchange.json();
        const data = parsed.ok ? getPath(parsed.value, 'data') : undefined;
        const code = parsed.ok ? getPath(parsed.value, 'code') : undefined;
        const problems = [
          data !== undefined && data !== null ? 'response contains resource data' : '',
          exchange.status === 403 && code !== expectedCode
            ? `error code ${String(code)}, expected ${expectedCode}`
            : '',
        ].filter(Boolean);
        return {
          name: exchange.label.replace('authorization.permission:', ''),
          status: problems.length ? 'FAILED' : 'PASSED',
          expected: { data: 'absent', code: expectedCode },
          actual: { status: exchange.status, code },
          message: problems.join('; ') || undefined,
          correlationId: exchange.correlationId,
        };
      });
    return fromChecks(checks, 'forbidden responses', 'no denied responses to inspect');
  },
});
