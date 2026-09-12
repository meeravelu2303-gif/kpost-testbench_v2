import { apiConfig } from '@config/api.config';
import { createFieldConventionValidator } from './field-convention';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const emailValidator = createFieldConventionValidator({
  name: 'common.email',
  noun: 'email',
  description: 'Email fields contain syntactically valid addresses',
  field: apiConfig.dataConventions.email.field,
  check: (value) =>
    typeof value === 'string' && EMAIL.test(value) ? undefined : 'not a valid email address',
});
