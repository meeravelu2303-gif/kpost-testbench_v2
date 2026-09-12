import path from 'node:path';
import { OPENAPI_DIR } from '@config/constants';
import { loadOpenApiEndpoints } from '../registry/endpoint-loader';

/**
 * Contract-first example: method, path, auth, roles, query/response schemas and expected status
 * come from the OpenAPI document. Only what OpenAPI cannot express is added here.
 *
 * These are the BENCH'S OWN fixtures, served by `mock-server/` - `/dictionary/terms` is not a
 * KPost route. Without `mockFixture: true` they were called on the live KPost host, where they
 * 404 and fail every validator, and the bug filer proposed six tickets against
 * `KPost API / kpost-webservice-application` for an endpoint KPost does not have. A false bug on a
 * developer's queue costs more than a missing one: it teaches them to distrust the whole report.
 */
export const dictionaryApis = loadOpenApiEndpoints(
  path.join(OPENAPI_DIR, 'dictionary.openapi.json'),
  {
    'list-dictionary-terms': {
      mockFixture: true,
      request: () => ({ query: { page: 1, pageSize: 20, language: 'en' } }),
      pagination: true,
    },
  },
).map((definition) => ({ ...definition, mockFixture: true }));
