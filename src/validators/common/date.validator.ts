import { apiConfig } from '@config/api.config';
import { thresholds } from '@config/thresholds.config';
import type { CheckDetail } from '@engine/validation-result';
import { isPlainObject, walkJson } from '@utils/json';
import { createFieldConventionValidator } from './field-convention';

/**
 * A valid API date: date-only, or a date-time (`T` or space) with or without an offset. The APIs
 * use UTC by contract, so a missing offset means UTC.
 */
const ISO_8601 = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;
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
    'Date fields are valid ISO-8601 (date-only or GMT/UTC date-time), audit dates ordered and not in the future',
  field: apiConfig.dataConventions.date.field,
  check: (value, { key }) => {
    // A blank optional date is not malformed; presence is the schema check's job.
    if (value === '' || value === null || value === undefined) return undefined;
    // A range object under a `*Date` key (Kall's `repeatedDate`) is not a date scalar.
    if (typeof value === 'object') return undefined;
    // The same range serialized as a JSON string.
    if (typeof value === 'string' && /^\s*[[{]/.test(value)) return undefined;
    // An epoch timestamp is valid (most KPost dates are); only NaN or non-positive fails.
    if (typeof value === 'number') {
      return Number.isFinite(value) && value > 0 ? undefined : 'not a valid date (epoch expected)';
    }
    if (typeof value !== 'string' || !ISO_8601.test(value) || Number.isNaN(Date.parse(value))) {
      return 'not a valid ISO-8601 date (date-only, GMT/UTC date-time, or an epoch number)';
    }
    return AUDIT_FIELD.test(key) && Date.parse(value) > Date.now() + thresholds.clockSkewMs
      ? 'audit timestamp is in the future'
      : undefined;
  },
  extraChecks: auditOrderChecks,
});
