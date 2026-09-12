import { createRequestValidator } from './request-mutation';

const INVALID_ENUM_VALUE = '__INVALID_ENUM_VALUE__';

export const enumValidator = createRequestValidator({
  name: 'request.enum',
  description: 'A value outside the allowed enum/const is rejected',
  sections: ['body', 'query', 'path'],
  strategy: (field) =>
    !field.isRoot && (Array.isArray(field.schema.enum) || 'const' in field.schema)
      ? [{ label: 'value outside enum', value: INVALID_ENUM_VALUE }]
      : [],
});
