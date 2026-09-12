import { apiConfig } from '@config/api.config';
import { isPlainObject } from '@utils/json';
import { createRequestValidator, schemaType } from './request-mutation';

/** Applies to (nested) objects whose contract forbids additional properties. */
export const unknownFieldsValidator = createRequestValidator({
  name: 'request.unknown-fields',
  description:
    'Unknown properties are rejected where the contract is closed (additionalProperties: false)',
  severity: 'MEDIUM',
  sections: ['body'],
  strategy: (field, current) =>
    schemaType(field.schema) === 'object' &&
    field.schema.additionalProperties === false &&
    isPlainObject(current)
      ? [
          {
            label: 'unknown property',
            value: { ...current, [apiConfig.unknownFieldName]: 'unexpected' },
          },
        ]
      : [],
});
