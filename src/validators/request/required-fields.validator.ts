import { createRequestValidator, REMOVE } from './request-mutation';

export const requiredFieldsValidator = createRequestValidator({
  name: 'request.required-fields',
  description: 'Omitting any required body/query field is rejected',
  sections: ['body', 'query'],
  strategy: (field) =>
    !field.isRoot && field.required ? [{ label: 'missing required field', value: REMOVE }] : [],
});
