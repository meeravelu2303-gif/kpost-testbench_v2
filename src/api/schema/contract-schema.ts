import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { z } from 'zod';

/**
 * Endpoints may describe payloads with zod (code-first) or plain JSON Schema (OpenAPI-first).
 * Both are normalised to JSON Schema and validated by one Ajv instance, so schema validation,
 * negative-case generation and OpenAPI import all share a single implementation.
 */
export type JsonSchema = Record<string, unknown>;
export type ContractSchema = z.ZodType | JsonSchema;

export interface SchemaIssue {
  path: string;
  message: string;
  keyword: string;
}

function createAjv(coerceTypes: boolean): Ajv2020 {
  const ajv = new Ajv2020({ allErrors: true, strict: false, coerceTypes });
  addFormats(ajv);
  return ajv;
}

// Query/path parameters travel as strings, so they are validated with type coercion.
const validators = { strict: createAjv(false), coerce: createAjv(true) };
const jsonSchemaCache = new WeakMap<object, JsonSchema>();
const compiledCache = {
  strict: new WeakMap<object, ValidateFunction>(),
  coerce: new WeakMap<object, ValidateFunction>(),
};

export function isZodSchema(schema: ContractSchema): schema is z.ZodType {
  return '_zod' in schema;
}

export function toJsonSchema(schema: ContractSchema): JsonSchema {
  const cached = jsonSchemaCache.get(schema);
  if (cached) return cached;
  const json: JsonSchema = isZodSchema(schema)
    ? // `input` mode keeps z.object() open and z.strictObject() closed (additionalProperties: false).
      z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' })
    : schema;
  const { $schema: _dialect, ...withoutDialect } = json;
  jsonSchemaCache.set(schema, withoutDialect);
  return withoutDialect;
}

function compile(schema: ContractSchema, mode: keyof typeof validators): ValidateFunction {
  const json = toJsonSchema(schema);
  const cache = compiledCache[mode];
  let validate = cache.get(json);
  if (!validate) {
    validate = validators[mode].compile(json);
    cache.set(json, validate);
  }
  return validate;
}

function toIssue(error: ErrorObject): SchemaIssue {
  const path = error.instancePath.replace(/^\//, '').replace(/\//g, '.') || '(root)';
  return { path, message: error.message ?? 'is invalid', keyword: error.keyword };
}

export function validateSchema(
  schema: ContractSchema,
  data: unknown,
  options: { coerce?: boolean } = {},
): SchemaIssue[] {
  const validate = compile(schema, options.coerce ? 'coerce' : 'strict');
  // Ajv coercion mutates its input — validate a copy.
  const candidate: unknown = options.coerce ? structuredClone(data) : data;
  return validate(candidate) ? [] : (validate.errors ?? []).map(toIssue);
}

export function formatIssues(issues: readonly SchemaIssue[], limit = 5): string {
  const shown = issues.slice(0, limit).map((i) => `${i.path}: ${i.message}`);
  const more = issues.length > limit ? ` (+${issues.length - limit} more)` : '';
  return shown.join('; ') + more;
}
