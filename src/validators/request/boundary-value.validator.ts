import { createRequestValidator, type Candidate } from './request-mutation';

const num = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined);

export const boundaryValueValidator = createRequestValidator({
  name: 'request.boundary-value',
  description: 'Values just outside min/max length, value and item limits are rejected',
  sections: ['body', 'query', 'path'],
  strategy: (field, current) => {
    if (field.isRoot) return [];
    const s = field.schema;
    const candidates: Candidate[] = [];
    const minLength = num(s.minLength);
    const maxLength = num(s.maxLength);
    const minimum = num(s.minimum);
    const maximum = num(s.maximum);
    const exclusiveMinimum = num(s.exclusiveMinimum);
    const exclusiveMaximum = num(s.exclusiveMaximum);
    const maxItems = num(s.maxItems);

    if (minLength !== undefined && minLength > 0) {
      candidates.push({
        label: `length ${minLength - 1} (minLength ${minLength})`,
        value: 'a'.repeat(minLength - 1),
      });
    }
    if (maxLength !== undefined) {
      candidates.push({
        label: `length ${maxLength + 1} (maxLength ${maxLength})`,
        value: 'a'.repeat(maxLength + 1),
      });
    }
    if (minimum !== undefined)
      candidates.push({ label: `${minimum - 1} (minimum ${minimum})`, value: minimum - 1 });
    if (maximum !== undefined)
      candidates.push({ label: `${maximum + 1} (maximum ${maximum})`, value: maximum + 1 });
    if (exclusiveMinimum !== undefined)
      candidates.push({ label: `${exclusiveMinimum} (exclusiveMinimum)`, value: exclusiveMinimum });
    if (exclusiveMaximum !== undefined)
      candidates.push({ label: `${exclusiveMaximum} (exclusiveMaximum)`, value: exclusiveMaximum });
    if (maxItems !== undefined && Array.isArray(current) && current.length) {
      const sample: unknown = current[0];
      candidates.push({
        label: `${maxItems + 1} items (maxItems ${maxItems})`,
        value: Array.from({ length: maxItems + 1 }, () => sample),
      });
    }
    return candidates;
  },
});
