import type { JsonSchema } from '@api/schema/contract-schema';
import { createRequestValidator, type Candidate } from './request-mutation';

const num = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined);

/** A field's declared limits (from the workbook, or the backend source via `source-limits.ts`). */
export function fieldLimits(s: JsonSchema) {
  return {
    minLength: num(s.minLength),
    maxLength: num(s.maxLength),
    minimum: num(s.minimum),
    maximum: num(s.maximum),
    exclusiveMinimum: num(s.exclusiveMinimum),
    exclusiveMaximum: num(s.exclusiveMaximum),
    minItems: num(s.minItems),
    maxItems: num(s.maxItems),
  };
}

/**
 * Text filler: distinctive, so a value a write endpoint stored can be found and removed afterwards
 * (`tests/kpost-api/maintenance/boundary-filler-maintenance.spec.ts`).
 */
export const FILLER_TEXT = 'qaboundary';

/**
 * A string of `length` characters in the style of the current value: digits for a numeric field
 * (a mobile number), so the case breaks only the length and never a digits-only rule first.
 */
export function filler(length: number, current: unknown): string {
  const digits =
    typeof current === 'number' || (typeof current === 'string' && /^\d+$/.test(current));
  const n = Math.max(0, length);
  return digits ? '9'.repeat(n) : FILLER_TEXT.repeat(Math.ceil(n / FILLER_TEXT.length)).slice(0, n);
}

/**
 * A record identifier (`kallID`, `groupId`, `id`, `group_id`). A numeric edge value there names a
 * record that is not ours (kallID 1 is someone's call), so no edge value is sent into one.
 */
export function isIdentifierField(path: string): boolean {
  const last = path.split('.').pop() ?? '';
  return /^id$/i.test(last) || /[a-z0-9](ID|Id)$/.test(last) || /_id$/i.test(last);
}

/** `count` copies of the array's first item (an empty array when there is none to copy). */
export function itemsOf(count: number, current: unknown): unknown[] | undefined {
  if (!Array.isArray(current)) return undefined;
  if (count > 0 && !current.length) return undefined;
  const sample: unknown = current[0];
  return Array.from({ length: Math.max(0, count) }, () => sample);
}

export const boundaryValueValidator = createRequestValidator({
  name: 'request.boundary-value',
  description: 'Values just outside min/max length, value and item limits are rejected',
  sections: ['body', 'query', 'path'],
  withItems: true,
  strategy: (field, current) => {
    const s = field.schema;
    const limits = fieldLimits(s);
    // The whole body is mutated only as a list (an Admin save takes a JSON array).
    if (field.isRoot && s.type !== 'array') return [];
    const candidates: Candidate[] = [];
    const { minLength, maxLength, minimum, maximum, exclusiveMinimum, exclusiveMaximum } = limits;
    const { minItems, maxItems } = limits;

    if (minLength !== undefined && minLength > 0) {
      candidates.push({
        label: `length ${minLength - 1} (minLength ${minLength})`,
        value: filler(minLength - 1, current),
      });
    }
    if (maxLength !== undefined) {
      candidates.push({
        label: `length ${maxLength + 1} (maxLength ${maxLength})`,
        value: filler(maxLength + 1, current),
      });
    }
    // Below an id's minimum (0, -1) names nothing; above its maximum could name a real record.
    if (minimum !== undefined)
      candidates.push({ label: `${minimum - 1} (minimum ${minimum})`, value: minimum - 1 });
    if (maximum !== undefined && !isIdentifierField(field.path))
      candidates.push({ label: `${maximum + 1} (maximum ${maximum})`, value: maximum + 1 });
    if (exclusiveMinimum !== undefined)
      candidates.push({ label: `${exclusiveMinimum} (exclusiveMinimum)`, value: exclusiveMinimum });
    if (exclusiveMaximum !== undefined)
      candidates.push({ label: `${exclusiveMaximum} (exclusiveMaximum)`, value: exclusiveMaximum });
    const tooFew =
      minItems !== undefined && minItems > 0 ? itemsOf(minItems - 1, current) : undefined;
    if (tooFew)
      candidates.push({ label: `${minItems! - 1} items (minItems ${minItems})`, value: tooFew });
    const tooMany = maxItems !== undefined ? itemsOf(maxItems + 1, current) : undefined;
    if (tooMany)
      candidates.push({ label: `${maxItems! + 1} items (maxItems ${maxItems})`, value: tooMany });
    return candidates;
  },
});
