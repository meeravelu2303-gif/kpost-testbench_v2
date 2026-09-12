import path from 'node:path';
import { OPENAPI_DIR } from '@config/constants';
import { loadOpenApiEndpoints } from '../registry/endpoint-loader';

/**
 * Contract-first example: method, path, auth, roles, query/response schemas and expected status
 * come from the OpenAPI document. Only what OpenAPI cannot express is added here.
 */
export const dictionaryApis = loadOpenApiEndpoints(
  path.join(OPENAPI_DIR, 'dictionary.openapi.json'),
  {
    'list-dictionary-terms': {
      request: () => ({ query: { page: 1, pageSize: 20, language: 'en' } }),
      pagination: true,
    },
  },
);
