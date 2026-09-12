import { createRequestValidator, schemaType, wrongTypeValue } from './request-mutation';

export const dataTypeValidator = createRequestValidator({
  name: 'request.data-type',
  description: 'A value of the wrong JSON type is rejected',
  sections: ['body', 'query', 'path'],
  strategy: (field) => {
    const type = schemaType(field.schema);
    const value = wrongTypeValue(type);
    return field.isRoot || value === undefined
      ? []
      : [{ label: `${typeof value} instead of ${type}`, value }];
  },
});
