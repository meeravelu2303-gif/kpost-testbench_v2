import { thresholds } from '@config/thresholds.config';
import type { CheckDetail } from '@engine/validation-result';
import type { JsonObject } from '@utils/json';

/** Reusable, business-agnostic persistence checks. DB validations compose these. */

const detail = (name: string, ok: boolean, expected: unknown, actual: unknown): CheckDetail => ({
  name,
  status: ok ? 'PASSED' : 'FAILED',
  expected,
  actual,
});

const isIsoDate = (value: unknown): value is string =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value));

export const dbAssert = {
  exists(name: string, record: JsonObject | undefined): CheckDetail {
    return detail(`${name} exists`, record !== undefined, 'record', record ? 'found' : 'not found');
  },

  notExists(name: string, record: JsonObject | undefined): CheckDetail {
    return detail(
      `${name} does not exist`,
      record === undefined,
      'no record',
      record ? 'found' : 'not found',
    );
  },

  fieldsMatch(record: JsonObject | undefined, expected: JsonObject): CheckDetail[] {
    return Object.entries(expected).map(([field, value]) =>
      detail(`field ${field}`, record?.[field] === value, value, record?.[field]),
    );
  },

  auditFields(
    record: JsonObject | undefined,
    options: { createdBy?: boolean } = {},
  ): CheckDetail[] {
    const createdAt = record?.createdAt;
    const updatedAt = record?.updatedAt;
    const checks = [
      detail(
        'createdAt set',
        isIsoDate(createdAt) && Date.parse(createdAt) <= Date.now() + thresholds.clockSkewMs,
        'ISO timestamp, not in future',
        createdAt,
      ),
      detail('updatedAt set', isIsoDate(updatedAt), 'ISO timestamp', updatedAt),
      detail(
        'createdAt <= updatedAt',
        isIsoDate(createdAt) &&
          isIsoDate(updatedAt) &&
          Date.parse(createdAt) <= Date.parse(updatedAt),
        'ordered',
        { createdAt, updatedAt },
      ),
    ];
    if (options.createdBy)
      checks.push(
        detail(
          'createdBy set',
          typeof record?.createdBy === 'string',
          'actor id',
          record?.createdBy,
        ),
      );
    return checks;
  },

  updated(record: JsonObject | undefined): CheckDetail {
    const { createdAt, updatedAt } = record ?? {};
    return detail(
      'updatedAt advanced',
      isIsoDate(createdAt) && isIsoDate(updatedAt) && Date.parse(updatedAt) > Date.parse(createdAt),
      'updatedAt > createdAt',
      { createdAt, updatedAt },
    );
  },

  softDeleted(record: JsonObject | undefined): CheckDetail[] {
    return [
      detail(
        'row retained (soft delete)',
        record !== undefined,
        'row present',
        record ? 'present' : 'missing',
      ),
      detail('deletedAt set', isIsoDate(record?.deletedAt), 'ISO timestamp', record?.deletedAt),
      detail('isActive false', record?.isActive === false, false, record?.isActive),
    ];
  },

  notDeleted(record: JsonObject | undefined): CheckDetail {
    return detail(
      'not soft-deleted',
      record !== undefined && record.deletedAt === null,
      null,
      record?.deletedAt,
    );
  },

  foreignKey(name: string, parent: JsonObject | undefined): CheckDetail {
    return detail(
      `foreign key ${name}`,
      parent !== undefined,
      'parent exists',
      parent ? 'exists' : 'missing',
    );
  },
};
