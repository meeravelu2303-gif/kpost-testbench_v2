import { createRequestValidator } from './request-mutation';

export const nullValueValidator = createRequestValidator({
  name: 'request.null-value',
  description: 'null in a non-nullable field is rejected',
  sections: ['body'],
  strategy: (field) =>
    !field.isRoot && !field.nullable ? [{ label: 'null value', value: null }] : [],
});
