import { apiConfig } from '@config/api.config';
import { thresholds } from '@config/thresholds.config';
import type { CheckDetail } from '@engine/validation-result';
import { isPlainObject, walkJson } from '@utils/json';
import { createFieldConventionValidator } from './field-convention';

/**
 * A valid API date. The KPost APIs standardise on **GMT/UTC** — the server returns a common UTC time
 * and the UI converts it for display (confirmed by the API team) — so a timezone-less date-time is UTC
 * by contract, not an ambiguous value, and is accepted. What is accepted:
 *   - a **date-only** calendar value (`2022-05-01`) — an experience/birth/start date has no time or
 *     timezone, and requiring one was a false positive;
 *   - a **date-time**, `T`- or space-separated, with an explicit `Z` / `±HH:MM` / `±HHMM` offset OR
 *     none (treated as UTC per the API's GMT convention).
 * Real defects are still caught: an unparseable value (below), an out-of-order or future audit date.
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
    // An absent optional date (empty string / null) is not a MALFORMED date — a field like an
    // ongoing experience's end date is legitimately blank. Whether it should be present at all is
    // the schema/required check's job, not the format check's. Skip it here.
    if (value === '' || value === null || value === undefined) return undefined;
    // A STRUCTURED value under a `*Date`-named field is not a date scalar — e.g. Kall's
    // `repeatedDate: { start_date, end_date }` is a range object. The date-format check does not apply
    // to an object/array (that name collision is not a malformed date), so skip it.
    if (typeof value === 'object') return undefined;
    // An **epoch timestamp** (millis or seconds) is a valid, unambiguous time, and the KPost/KMail
    // APIs return most dates that way (e.g. `kmailSendDate: 1767010050000`). It is not a malformed
    // date, so accept a positive finite number; only a NaN / non-positive number is a real defect.
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
