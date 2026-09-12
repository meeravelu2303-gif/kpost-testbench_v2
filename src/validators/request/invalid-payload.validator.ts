import { isPlainObject } from '@utils/json';
import {
  createRequestValidator,
  schemaType,
  wrongTypeValue,
  type Candidate,
} from './request-mutation';

/** Structurally wrong payloads: wrong top-level shape, empty nested objects, invalid array items. */
export const invalidPayloadValidator = createRequestValidator({
  name: 'request.invalid-payload',
  description: 'Wrong payload shapes, invalid nested objects and invalid array items are rejected',
  sections: ['body'],
  strategy: (field): Candidate[] => {
    const type = schemaType(field.schema);
    if (field.isRoot) {
      return type === 'object'
        ? [
            { label: 'array instead of object', value: [] },
            { label: 'string instead of object', value: 'invalid-payload' },
            { label: 'number instead of object', value: 42 },
          ]
        : [];
    }
    if (type === 'object') return [{ label: 'invalid nested object', value: {} }];
    const items = field.schema.items;
    if (type === 'array' && isPlainObject(items)) {
      const invalidItem = wrongTypeValue(schemaType(items));
      return invalidItem === undefined
        ? []
        : [{ label: 'array with invalid item', value: [invalidItem] }];
    }
    return [];
  },
});
