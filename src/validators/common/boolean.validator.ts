import { apiConfig } from '@config/api.config';
import { createFieldConventionValidator } from './field-convention';

export const booleanValidator = createFieldConventionValidator({
  name: 'common.boolean',
  noun: 'boolean',
  description:
    'Flag fields (`is*`, `has*`, `enabled`, ...) are real booleans, not strings or numbers',
  severity: 'LOW',
  field: apiConfig.dataConventions.boolean.field,
  check: (value) => (typeof value === 'boolean' ? undefined : `${typeof value} instead of boolean`),
});
