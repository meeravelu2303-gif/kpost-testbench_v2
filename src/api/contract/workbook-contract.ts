import adminOpenApi from '../../../openapi/admin-api.openapi.json' with { type: 'json' };
import kmailOpenApi from '../../../openapi/kmail-api.openapi.json' with { type: 'json' };
import kpostOpenApi from '../../../openapi/kpost-api.openapi.json' with { type: 'json' };
import type { SuiteId } from '@config/ownership.config';
import { isPlainObject } from '@utils/json';
import type { HttpMethod } from '../client/request-builder';
import type { JsonSchema } from '../schema/contract-schema';

/**
 * Reads the generated contracts, so an endpoint definition never restates what the workbook
 * already says.
 *
 * Schemas and examples come from `openapi/*.openapi.json`, which is produced by
 * `npm run contract:excel` from `KPOST API (N).xlsx`. A definition therefore carries only what the
 * workbook cannot express — which values to send, whether a call is destructive, which business
 * rules apply — and a new workbook dump updates every schema and example without a code change.
 *
 * Asking for an endpoint that is not in the contracts **throws**. Silently returning `undefined`
 * would let a typo become an endpoint with no schema, validated against nothing and reported as
 * passing.
 */
export interface WorkbookContract {
  method: HttpMethod;
  path: string;
  /** Where in the workbook this came from, e.g. `KatchupAPI:R10`. */
  source: string;
  /** How the HTTP method was decided - see src/config/response-contract.ts and docs. */
  methodSource: string;
  requestSchema?: JsonSchema;
  responseSchema?: JsonSchema;
  requestExample?: Record<string, unknown>;
  responseExample?: unknown;
}

const DOCUMENTS: Partial<Record<SuiteId, unknown>> = {
  'kpost-api': kpostOpenApi,
  'kmail-api': kmailOpenApi,
  'admin-api': adminOpenApi,
};

function operation(suite: SuiteId, method: HttpMethod, path: string): Record<string, unknown> {
  const document = DOCUMENTS[suite];
  if (!isPlainObject(document) || !isPlainObject(document.paths)) {
    throw new Error(`No generated contract for suite "${suite}"`);
  }
  const item = document.paths[path];
  if (!isPlainObject(item)) {
    throw new Error(
      `${path} is not in the ${suite} contract. Check the path against openapi/${suite}.openapi.json — ` +
        'it is generated, so a missing path means the workbook does not document it.',
    );
  }
  const found = item[method.toLowerCase()];
  if (!isPlainObject(found)) {
    const available = Object.keys(item)
      .filter((key) => key !== 'parameters')
      .map((key) => key.toUpperCase())
      .join(', ');
    throw new Error(
      `${method} ${path} is not in the ${suite} contract (documented: ${available || 'none'})`,
    );
  }
  return found;
}

function jsonContent(container: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(container)) return undefined;
  const content = container.content;
  if (!isPlainObject(content)) return undefined;
  const json = content['application/json'];
  return isPlainObject(json) ? json : undefined;
}

/** The documented contract for one endpoint. Throws when the workbook does not describe it. */
export function workbookContract(
  suite: SuiteId,
  method: HttpMethod,
  path: string,
): WorkbookContract {
  const op = operation(suite, method, path);
  const request = jsonContent(op.requestBody);
  const responses = isPlainObject(op.responses) ? op.responses : {};
  const success = jsonContent(responses['200']);

  return {
    method,
    path,
    source: typeof op['x-excel-source'] === 'string' ? op['x-excel-source'] : 'unknown',
    methodSource: typeof op['x-method-source'] === 'string' ? op['x-method-source'] : 'unknown',
    requestSchema: isPlainObject(request?.schema) ? request.schema : undefined,
    responseSchema: isPlainObject(success?.schema) ? success.schema : undefined,
    requestExample: isPlainObject(request?.example) ? request.example : undefined,
    responseExample: success?.example,
  };
}

/** Every path the generated contract documents for a suite — used by coverage self-tests. */
export function contractPaths(suite: SuiteId): string[] {
  const document = DOCUMENTS[suite];
  if (!isPlainObject(document) || !isPlainObject(document.paths)) return [];
  return Object.keys(document.paths);
}
