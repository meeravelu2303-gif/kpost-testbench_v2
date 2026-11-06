import adminLimits from './source/admin-api.limits.json' with { type: 'json' };
import kmailLimits from './source/kmail-api.limits.json' with { type: 'json' };
import kpostLimits from './source/kpost-api.limits.json' with { type: 'json' };
import type { SuiteId } from '@config/ownership.config';
import { isPlainObject } from '@utils/json';
import { toJsonSchema, type ContractSchema, type JsonSchema } from '../schema/contract-schema';

/**
 * Input limits read from the backend source, for the boundary validators. The workbook lists field
 * types only, so without these `request.boundary-value` had nothing to test. Each limit cites where
 * it comes from: a bean-validation annotation, a hand-written check in the controller or service,
 * or the width of the database column the field is saved into (the QA DB runs in strict mode, so a
 * longer value is refused by MySQL and the API must turn that into a clean error, not a 500).
 *
 * Data: `src/api/contract/source/<suite>.limits.json` (bench-maintained, not generated).
 */
export type LimitKeyword =
  'minLength' | 'maxLength' | 'minimum' | 'maximum' | 'minItems' | 'maxItems';

export interface SourceLimit {
  value: number;
  /** `bean-validation`, `service-check`, or `db-column <TABLE>.<column> <type>`. */
  from: string;
  /** File and line in the developer source, e.g. `ProfileServiceImpl.java:412`. */
  source: string;
}

/**
 * Why a field has no limit to probe: it is only compared, parsed, used as a flag or never read, so
 * neither a check nor a column bounds it (cited like a limit).
 */
export interface NoLimit {
  reason: string;
  source: string;
}

export type FieldLimits = Partial<Record<LimitKeyword, SourceLimit>> & { none?: NoLimit };

/** Field key: `<section>.<path>`; `[]` marks array items, `(body)` the whole body. */
export type EndpointLimits = Record<string, FieldLimits>;

interface LimitsDocument {
  suite: string;
  derivedFrom: string;
  derivedOn: string;
  endpoints: Record<string, EndpointLimits>;
}

const DOCUMENTS: Partial<Record<SuiteId, LimitsDocument>> = {
  'kpost-api': kpostLimits,
  'kmail-api': kmailLimits,
  'admin-api': adminLimits,
};

export type LimitSection = 'body' | 'query' | 'path';

export function sourceLimits(suite: SuiteId, id: string): EndpointLimits | undefined {
  return DOCUMENTS[suite]?.endpoints[id];
}

/** The cited reason a field has no limit, when the limits file records one. */
export function noLimitReason(suite: SuiteId, id: string, field: string): NoLimit | undefined {
  return sourceLimits(suite, id)?.[field]?.none;
}

export function sourceLimitIds(suite: SuiteId): string[] {
  return Object.keys(DOCUMENTS[suite]?.endpoints ?? {});
}

/** Splits `memberDetails[].kpostID` into schema steps: property names and `[]` for items. */
export function limitSteps(path: string): string[] {
  if (path === '(body)') return [];
  return path.replace(/\[\]/g, '.[]').split('.').filter(Boolean);
}

function withLimitAt(
  schema: JsonSchema,
  steps: readonly string[],
  limits: FieldLimits,
): JsonSchema {
  if (!steps.length) {
    // A cited "no limit" adds nothing to the schema.
    const keywords = Object.fromEntries(
      Object.entries(limits)
        .filter((entry): entry is [LimitKeyword, SourceLimit] => entry[0] !== 'none')
        .map(([keyword, limit]) => [keyword, limit.value]),
    );
    return { ...schema, ...keywords };
  }
  const [head, ...rest] = steps as [string, ...string[]];
  if (head === '[]') {
    const items = isPlainObject(schema.items) ? schema.items : {};
    return { ...schema, items: withLimitAt(items, rest, limits) };
  }
  const properties = isPlainObject(schema.properties)
    ? (schema.properties as Record<string, JsonSchema>)
    : {};
  // A field the workbook does not list gets the limit alone, with no type: JSON Schema applies a
  // length limit to strings only, so a number the client really sends there is still valid.
  const child = isPlainObject(properties[head]) ? properties[head] : {};
  return {
    ...schema,
    properties: { ...properties, [head]: withLimitAt(child, rest, limits) },
  };
}

const cache = new Map<string, JsonSchema | undefined>();

/**
 * The section's schema with the source limits written into it. Only an endpoint that already has a
 * schema for the section gets them: a limit never invents a request shape on its own.
 */
export function withSourceLimits(
  suite: SuiteId,
  id: string,
  section: LimitSection,
  schema: ContractSchema | undefined,
): ContractSchema | undefined {
  const limits = sourceLimits(suite, id);
  if (!schema || !limits) return schema;
  const key = `${suite} ${id} ${section}`;
  if (cache.has(key)) return cache.get(key) ?? schema;
  let json = toJsonSchema(schema);
  for (const [field, fieldLimits] of Object.entries(limits)) {
    const dot = field.indexOf('.');
    if (field.slice(0, dot) !== section) continue;
    json = withLimitAt(json, limitSteps(field.slice(dot + 1)), fieldLimits);
  }
  cache.set(key, json);
  return json;
}
