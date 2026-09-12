import type { SuiteOwnership } from '@config/ownership.config';
import { isPlainObject } from '@utils/json';
import type { EndpointDefinition } from '../registry/endpoint-definition';
import { loadOpenApiEndpoints } from '../registry/endpoint-loader';
import { toJsonSchema } from '../schema/contract-schema';

/**
 * Read-only contract coverage for a module, derived from its OpenAPI document.
 *
 * KMail (82 operations) and Admin (112) are separate services with their own specs. Registering
 * every operation would mean inventing request payloads the specs cannot supply, and a run full
 * of failures that say more about the bench than about the API. So this takes the operations
 * that are safe to call without invented data — GETs with no path parameters and no required
 * query parameters — and lets the central engine validate them in full (auth, status, schema,
 * headers, errors, security, performance).
 *
 * Anything deeper (a POST with a body, a resource that must be created first) gets a
 * hand-written definition with a request factory, exactly like the KPost core endpoints.
 */
export interface ModuleLoadOptions {
  /** Upper bound, so one module cannot dominate a run. */
  max?: number;
  /** Extra per-endpoint configuration, keyed by operationId. */
  overrides?: Record<string, Partial<EndpointDefinition>>;
}

const DEFAULT_MAX = 25;

/**
 * Framework endpoints, not API surface: Spring Boot serves an index page at `/` and a generic
 * `/error` handler. They carry no contract, and a ticket about them helps nobody.
 */
const NOT_API_SURFACE = new Set(['/', '/error']);

function hasRequiredQuery(definition: EndpointDefinition): boolean {
  if (!definition.querySchema) return false;
  const schema = toJsonSchema(definition.querySchema);
  return Array.isArray(schema.required) && schema.required.length > 0;
}

export function loadModuleEndpoints(
  suite: SuiteOwnership,
  options: ModuleLoadOptions = {},
): EndpointDefinition[] {
  if (!suite.specFile) return [];

  return loadOpenApiEndpoints(suite.specFile, options.overrides ?? {})
    .filter(
      (definition) =>
        definition.method === 'GET' &&
        !NOT_API_SURFACE.has(definition.path) &&
        !definition.path.includes('{') &&
        !hasRequiredQuery(definition),
    )
    .slice(0, options.max ?? DEFAULT_MAX)
    .map((definition) => ({
      ...definition,
      // Namespaced: two modules may legitimately use the same operationId.
      id: `${suite.id}:${definition.id}`,
      // The module decides the base URL, the Bugzilla product and the owning developer.
      suite: suite.id,
      // Spec tags are the Bugzilla component names for these products.
      tags: definition.tags ?? [],
    }));
}

/** True when the spec's shape is what the loader expects — used by the coverage report. */
export function isLoadableSpec(document: unknown): boolean {
  return isPlainObject(document) && isPlainObject(document.paths);
}
