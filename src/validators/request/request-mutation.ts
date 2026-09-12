import type { RequestSpec } from '@api/client/request-builder';
import {
  toJsonSchema,
  validateSchema,
  type ContractSchema,
  type JsonSchema,
} from '@api/schema/contract-schema';
import { thresholds } from '@config/thresholds.config';
import { apiConfig } from '@config/api.config';
import { runProbes, type ProbeCase } from '@engine/probe';
import type { ValidationContext } from '@engine/validation-context';
import { PROFILE_SETS, type ResolvedEndpoint } from '@engine/validation-policy';
import type { Severity } from '@engine/validation-result';
import { defineValidator, type Validator } from '@engine/validator';
import { deletePath, getPath, isPlainObject, setPath } from '@utils/json';

/**
 * Negative request generation, derived from the endpoint's contract (zod or OpenAPI/JSON
 * Schema) — never from hand-written per-endpoint rules. Each request validator contributes only
 * a small *strategy* ("which invalid values exist for this field"); traversal, applying the
 * mutation, proving it violates the contract, sending and asserting happen here once.
 */
export type RequestSection = 'body' | 'query' | 'path';

/** Candidate value meaning "remove this property". */
export const REMOVE = Symbol('remove');

export interface FieldInfo {
  section: RequestSection;
  /** Dot path inside the section ('' = the whole body). */
  path: string;
  schema: JsonSchema;
  required: boolean;
  nullable: boolean;
  isRoot: boolean;
}

export interface Candidate {
  label: string;
  value: unknown;
}

export type MutationStrategy = (field: FieldInfo, current: unknown) => Candidate[];

const SPEC_KEY = { body: 'body', query: 'query', path: 'pathParams' } as const satisfies Record<
  RequestSection,
  keyof RequestSpec
>;

export function sectionSchema(
  endpoint: ResolvedEndpoint,
  section: RequestSection,
): ContractSchema | undefined {
  if (section === 'body') return endpoint.requestSchema;
  return section === 'query' ? endpoint.querySchema : endpoint.pathParamsSchema;
}

export function schemaType(schema: JsonSchema): string | undefined {
  return typeof schema.type === 'string' ? schema.type : undefined;
}

function unwrapNullable(schema: JsonSchema): { schema: JsonSchema; nullable: boolean } {
  const variants = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(variants)) {
    const nonNull = variants.filter((v): v is JsonSchema => isPlainObject(v) && v.type !== 'null');
    if (nonNull.length === 1 && nonNull.length !== variants.length)
      return { schema: nonNull[0]!, nullable: true };
  }
  if (Array.isArray(schema.type) && schema.type.includes('null')) {
    return { schema: { ...schema, type: schema.type.find((t) => t !== 'null') }, nullable: true };
  }
  return { schema, nullable: schema.nullable === true };
}

/** Flattens a JSON Schema into fields (root first, then nested properties depth-first). */
export function collectFields(
  schema: JsonSchema,
  section: RequestSection,
  prefix = '',
  required = true,
): FieldInfo[] {
  const { schema: unwrapped, nullable } = unwrapNullable(schema);
  const fields: FieldInfo[] = [
    { section, path: prefix, schema: unwrapped, required, nullable, isRoot: prefix === '' },
  ];
  const properties = isPlainObject(unwrapped.properties) ? unwrapped.properties : {};
  const requiredKeys = Array.isArray(unwrapped.required) ? unwrapped.required : [];
  for (const [key, child] of Object.entries(properties)) {
    if (!isPlainObject(child)) continue;
    fields.push(
      ...collectFields(
        child,
        section,
        prefix ? `${prefix}.${key}` : key,
        requiredKeys.includes(key),
      ),
    );
  }
  return fields;
}

/** Returns a copy of `spec` with `value` written into the field. */
export function applyCandidate(spec: RequestSpec, field: FieldInfo, value: unknown): RequestSpec {
  const key = SPEC_KEY[field.section];
  const current: unknown = spec[key] ?? {};
  let next: unknown;
  if (field.isRoot) next = value;
  else if (value === REMOVE) next = deletePath(current, field.path);
  else next = setPath(current, field.path, value);
  return { ...spec, [key]: next };
}

/** A value of the wrong JSON type for `type`. */
export function wrongTypeValue(type: string | undefined): unknown {
  switch (type) {
    case 'string':
      return 12345;
    case 'integer':
    case 'number':
      return 'not-a-number';
    case 'boolean':
      return 'not-a-boolean';
    case 'array':
      return 'not-an-array';
    case 'object':
      return 'not-an-object';
    default:
      return undefined;
  }
}

function parentExists(values: unknown, path: string): boolean {
  const lastDot = path.lastIndexOf('.');
  return lastDot < 0 || isPlainObject(getPath(values, path.slice(0, lastDot)));
}

async function buildCases(
  context: ValidationContext,
  sections: readonly RequestSection[],
  strategy: MutationStrategy,
): Promise<ProbeCase[]> {
  const base = await context.nextRequest();
  const cases: ProbeCase[] = [];

  for (const section of sections) {
    const schema = sectionSchema(context.endpoint, section);
    if (!schema) continue;
    const values: unknown = base[SPEC_KEY[section]];

    for (const field of collectFields(toJsonSchema(schema), section)) {
      if (field.isRoot && section !== 'body') continue;
      if (!field.isRoot && !parentExists(values, field.path)) continue;
      const current = field.isRoot ? values : getPath(values, field.path);

      for (const candidate of strategy(field, current)) {
        const spec = applyCandidate(base, field, candidate.value);
        // Only send cases the contract itself rejects — no false positives from loose schemas.
        const violations = validateSchema(schema, spec[SPEC_KEY[section]], {
          coerce: section !== 'body',
        });
        if (!violations.length) continue;
        cases.push({
          name: `${section}.${field.path || '(root)'}: ${candidate.label}`,
          spec,
          expectedStatus:
            section === 'path'
              ? apiConfig.invalidPathParamStatus
              : context.endpoint.invalidRequestStatus,
        });
        if (cases.length >= thresholds.request.maxCasesPerValidator) return cases;
      }
    }
  }
  return cases;
}

export interface RequestValidatorOptions {
  name: string;
  description: string;
  severity?: Severity;
  sections: readonly RequestSection[];
  strategy: MutationStrategy;
}

/** Factory used by every schema-driven request validator. */
export function createRequestValidator(options: RequestValidatorOptions): Validator {
  return defineValidator({
    name: options.name,
    category: 'REQUEST',
    severity: options.severity ?? 'HIGH',
    description: options.description,
    toggle: 'request',
    profiles: PROFILE_SETS.DEEP,
    stage: 'probe',
    appliesTo: (context) =>
      options.sections.some((section) => sectionSchema(context.endpoint, section))
        ? true
        : `endpoint defines no ${options.sections.join('/')} schema`,
    check: async (context) =>
      runProbes(
        context,
        options.name,
        await buildCases(context, options.sections, options.strategy),
        'negative request cases',
      ),
  });
}
