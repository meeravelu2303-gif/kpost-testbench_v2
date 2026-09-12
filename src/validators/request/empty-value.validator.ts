import { createRequestValidator, schemaType } from './request-mutation';

export const emptyValueValidator = createRequestValidator({
  name: 'request.empty-value',
  description: 'Empty strings/arrays/objects are rejected where the contract forbids them',
  severity: 'MEDIUM',
  sections: ['body', 'query'],
  strategy: (field) => {
    if (field.isRoot) return [];
    switch (schemaType(field.schema)) {
      case 'string':
        return [{ label: 'empty string', value: '' }];
      case 'array':
        return [{ label: 'empty array', value: [] }];
      case 'object':
        return [{ label: 'empty object', value: {} }];
      default:
        return [];
    }
  },
});
