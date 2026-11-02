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

/** Whether the live method has a body; a GET/HEAD body is ignored, so fuzzing it misleads. */
export function carriesRequestBody(endpoint: ResolvedEndpoint): boolean {
  return endpoint.method !== 'GET';
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

/**
 * Flattens a JSON Schema into fields (root first, then nested properties depth-first). With
 * `withItems`, an array's first item is walked too (path `<array>.0`), so limits on the fields of
 * array items (an Admin save body, a member list) are reachable.
 */
export function collectFields(
  schema: JsonSchema,
  section: RequestSection,
  prefix = '',
  required = true,
  withItems = false,
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
        withItems,
      ),
    );
  }
  if (withItems && isPlainObject(unwrapped.items)) {
    fields.push(
      ...collectFields(unwrapped.items, section, prefix ? `${prefix}.0` : '0', true, withItems),
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
  if (lastDot < 0) return true;
  const parent = getPath(values, path.slice(0, lastDot));
  return isPlainObject(parent) || Array.isArray(parent);
}

/** An array item (`.0` path) is only mutated when the base request really has one. */
const isItemPath = (path: string): boolean => /(^|\.)\d+$/.test(path);

async function buildCases(
  context: ValidationContext,
  options: RequestValidatorOptions,
): Promise<ProbeCase[]> {
  const base = await context.nextRequest();
  const cases: ProbeCase[] = [];
  const acceptValid = options.cases === 'valid';

  for (const section of options.sections) {
    // No body fuzzing on a GET/HEAD; query and path still apply.
    if (section === 'body' && !carriesRequestBody(context.endpoint)) continue;
    const schema = sectionSchema(context.endpoint, section);
    if (!schema) continue;
    const values: unknown = base[SPEC_KEY[section]];

    for (const field of collectFields(toJsonSchema(schema), section, '', true, options.withItems)) {
      if (field.isRoot && section !== 'body') continue;
      if (!field.isRoot && !parentExists(values, field.path)) continue;
      const current = field.isRoot ? values : getPath(values, field.path);
      if (isItemPath(field.path) && current === undefined) continue;

      for (const candidate of options.strategy(field, current)) {
        const spec = applyCandidate(base, field, candidate.value);
        // Negative cases are sent only when the contract itself rejects them (no false positives
        // from loose schemas); valid-edge cases only when it accepts them.
        const violations = validateSchema(schema, spec[SPEC_KEY[section]], {
          coerce: section !== 'body',
        });
        if (acceptValid ? violations.length : !violations.length) continue;
        cases.push({
          name: `${section}.${field.path || '(root)'}: ${candidate.label}`,
          spec,
          // A valid edge value may still fail a business rule; it must just never crash (5xx).
          expectedStatus: acceptValid
            ? undefined
            : section === 'path'
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
  /** Walk array items too (see `collectFields`). */
  withItems?: boolean;
  /**
   * `invalid` (default): send values the contract rejects and expect a 4xx. `valid`: send values
   * the contract accepts (the edge of a limit) and expect anything but a 5xx.
   */
  cases?: 'invalid' | 'valid';
  /** An extra reason this validator does not apply to the endpoint, or true. */
  onlyWhen?: (endpoint: ResolvedEndpoint) => true | string;
  /**
   * After the cases, re-send the endpoint's normal request once, so a record a valid edge value
   * really changed (a profile field) is put back to the bench's own value. Writes only.
   */
  restoreAfter?: boolean;
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
    appliesTo: (context) => {
      const extra = options.onlyWhen?.(context.endpoint) ?? true;
      if (extra !== true) return extra;
      return options.sections.some(
        (section) =>
          (section !== 'body' || carriesRequestBody(context.endpoint)) &&
          sectionSchema(context.endpoint, section),
      )
        ? true
        : `no fuzzable ${options.sections.join('/')} schema (a GET carries no request body)`;
    },
    check: async (context) => {
      const cases = await buildCases(context, options);
      const outcome = await runProbes(
        context,
        options.name,
        cases,
        options.cases === 'valid' ? 'edge-of-limit request cases' : 'negative request cases',
      );
      if (options.restoreAfter && context.endpoint.destructive && cases.length) {
        // Best effort: the verdict is already decided; a failed restore must not change it.
        await context
          .send(await context.nextRequest(), { label: `${options.name}:restore` })
          .catch(() => undefined);
      }
      return outcome;
    },
  });
}
