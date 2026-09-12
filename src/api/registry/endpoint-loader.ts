import { readFileSync } from 'node:fs';
import { ROLES, type Role } from '@config/auth.config';
import { isPlainObject, type JsonObject } from '@utils/json';
import type { HttpMethod } from '../client/request-builder';
import type { JsonSchema } from '../schema/contract-schema';
import type { EndpointDefinition } from './endpoint-definition';

/**
 * Builds EndpointDefinitions from an OpenAPI 3.1 document, so contract-first APIs need no
 * hand-written definition at all. Endpoint-specific behaviour the spec cannot express
 * (request factory, business rules, DB validations) is supplied via `overrides`.
 *
 * Supported: operationId, tags, security, 2xx responses (enveloped `data` schema is unwrapped),
 * JSON request bodies, path/query parameters, local `$ref`s and the `x-roles` extension.
 */
const METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

interface OpenApiDocument {
  security?: unknown[];
  paths: Record<string, Record<string, JsonObject>>;
  components?: JsonObject;
}

export function loadOpenApiEndpoints(
  specFile: string,
  overrides: Record<string, Partial<EndpointDefinition>> = {},
): EndpointDefinition[] {
  const document = JSON.parse(readFileSync(specFile, 'utf8')) as OpenApiDocument;
  const resolve = (node: unknown): unknown => dereference(node, document as unknown as JsonObject);
  const endpoints: EndpointDefinition[] = [];

  for (const [path, pathItem] of Object.entries(document.paths)) {
    for (const method of METHODS) {
      const operation = pathItem[method.toLowerCase()];
      if (!operation) continue;
      const id = operation.operationId;
      if (typeof id !== 'string')
        throw new Error(`${specFile}: ${method} ${path} has no operationId`);

      const successCodes = Object.keys((operation.responses as JsonObject | undefined) ?? {})
        .filter((code) => /^2\d\d$/.test(code))
        .map(Number);
      const security = (operation.security ?? document.security ?? []) as unknown[];
      const roles = (operation['x-roles'] as string[] | undefined)?.filter((r): r is Role =>
        (ROLES as readonly string[]).includes(r),
      );
      const parameters = (resolve(operation.parameters ?? []) as JsonObject[]).filter(
        isPlainObject,
      );

      const definition: EndpointDefinition = {
        id,
        method,
        path,
        summary: operation.summary as string | undefined,
        tags: operation.tags as string[] | undefined,
        expectedStatus: successCodes.length ? successCodes : undefined,
        authentication: { required: security.length > 0 },
        authorization: roles ? { roles } : undefined,
        requestSchema: jsonBodySchema(resolve(operation.requestBody)),
        pathParamsSchema: parameterSchema(parameters, 'path'),
        querySchema: parameterSchema(parameters, 'query'),
        responseSchema: responseDataSchema(resolve(operation.responses), successCodes[0]),
      };
      endpoints.push({ ...definition, ...overrides[id] });
    }
  }
  return endpoints;
}

function dereference(node: unknown, root: JsonObject, seen = new Set<string>()): unknown {
  if (Array.isArray(node)) return node.map((item) => dereference(item, root, seen));
  if (!isPlainObject(node)) return node;
  const ref = node.$ref;
  if (typeof ref === 'string' && ref.startsWith('#/')) {
    if (seen.has(ref)) throw new Error(`Circular $ref ${ref} is not supported`);
    const target = ref
      .slice(2)
      .split('/')
      .reduce<unknown>((current, key) => (isPlainObject(current) ? current[key] : undefined), root);
    return dereference(target, root, new Set([...seen, ref]));
  }
  return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, dereference(v, root, seen)]));
}

function jsonBodySchema(requestBody: unknown): JsonSchema | undefined {
  if (!isPlainObject(requestBody)) return undefined;
  const content = requestBody.content as JsonObject | undefined;
  const json = content?.['application/json'];
  return isPlainObject(json) && isPlainObject(json.schema) ? json.schema : undefined;
}

function parameterSchema(
  parameters: JsonObject[],
  location: 'path' | 'query',
): JsonSchema | undefined {
  const selected = parameters.filter((p) => p.in === location && typeof p.name === 'string');
  if (!selected.length) return undefined;
  return {
    type: 'object',
    properties: Object.fromEntries(selected.map((p) => [p.name as string, p.schema ?? {}])),
    required: selected.filter((p) => p.required === true).map((p) => p.name as string),
  };
}

function responseDataSchema(
  responses: unknown,
  status: number | undefined,
): JsonSchema | undefined {
  if (!isPlainObject(responses) || status === undefined) return undefined;
  const schema = jsonBodySchema(responses[String(status)]);
  if (!schema) return undefined;
  const properties = schema.properties;
  // Enveloped responses describe `{ success, data, metadata }` — validators check `data`.
  return isPlainObject(properties) && isPlainObject(properties.data) ? properties.data : schema;
}
