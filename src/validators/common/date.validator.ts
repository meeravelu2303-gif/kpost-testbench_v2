import { apiConfig } from '@config/api.config';
import { thresholds } from '@config/thresholds.config';
import type { CheckDetail } from '@engine/validation-result';
import { isPlainObject, walkJson } from '@utils/json';
import { createFieldConventionValidator } from './field-convention';

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
/** Audit timestamps describe the past; other dates (expiresAt, dueDate) may be in the future. */
const AUDIT_FIELD = /^(createdAt|updatedAt|deletedAt)$/;

function auditOrderChecks(data: unknown): CheckDetail[] {
  const objects = [data, ...walkJson(data).map((v) => v.value)].filter(isPlainObject);
  return objects
    .filter((o) => typeof o.createdAt === 'string' && typeof o.updatedAt === 'string')
    .map((o, index) => {
      const ok = Date.parse(o.updatedAt as string) >= Date.parse(o.createdAt as string);
      return {
        name: `createdAt <= updatedAt #${index + 1}`,
        status: ok ? 'PASSED' : 'FAILED',
        expected: 'createdAt <= updatedAt',
        actual: { createdAt: o.createdAt, updatedAt: o.updatedAt },
      };
    });
}

export const dateValidator = createFieldConventionValidator({
  name: 'common.date',
  noun: 'date',
  description:
    'Date fields are ISO-8601 with timezone, audit dates are not in the future and ordered',
  field: apiConfig.dataConventions.date.field,
  check: (value, { key }) => {
    if (typeof value !== 'string' || !ISO_8601.test(value) || Number.isNaN(Date.parse(value))) {
      return 'not an ISO-8601 date-time with timezone';
    }
    return AUDIT_FIELD.test(key) && Date.parse(value) > Date.now() + thresholds.clockSkewMs
      ? 'audit timestamp is in the future'
      : undefined;
  },
  extraChecks: auditOrderChecks,
});
