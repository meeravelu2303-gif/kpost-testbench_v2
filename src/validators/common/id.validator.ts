import { apiConfig } from '@config/api.config';
import { createFieldConventionValidator } from './field-convention';

export const idValidator = createFieldConventionValidator({
  name: 'common.id',
  noun: 'ID',
  description: 'ID fields (`id`, `*Id`) use the platform ID format',
  field: apiConfig.dataConventions.id.field,
  check: (value) =>
    typeof value === 'string' && apiConfig.dataConventions.id.value.test(value)
      ? undefined
      : 'not a valid ID',
});
