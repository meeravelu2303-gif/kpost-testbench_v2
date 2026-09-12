import { apiConfig } from '@config/api.config';
import { createFieldConventionValidator } from './field-convention';

export const idValidator = createFieldConventionValidator({
  name: 'common.id',
  noun: 'ID',
  description: 'ID fields (`id`, `*Id`) use the platform ID format',
  field: apiConfig.dataConventions.id.field,
  // The shape of an identifier is a property of the API - see src/config/response-contract.ts.
  check: (value, _visit, context) => {
    const { pattern, description } = context.endpoint.contract.idFormat;
    return pattern.test(String(value)) ? undefined : `not ${description}`;
  },
});
