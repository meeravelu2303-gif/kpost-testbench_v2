import { DEFAULT_SUITE, type SuiteId } from '@config/ownership.config';
import type { HttpMethod } from '../client/request-builder';
import type { EndpointDefinition } from './endpoint-definition';

export interface EndpointFilter {
  ids?: readonly string[];
  /** Endpoint must have at least one of these tags. */
  tags?: readonly string[];
  /**
   * Endpoint must have NONE of these tags. Lets a spec cover a module while leaving out the
   * endpoints it cannot run yet (`needs-login`) without deleting their definitions - which would
   * silently drop them from coverage.
   */
  excludeTags?: readonly string[];
  methods?: readonly HttpMethod[];
  /** Module the endpoint belongs to (see src/config/ownership.config.ts). */
  suites?: readonly SuiteId[];
}

const suiteOf = (definition: EndpointDefinition): SuiteId => definition.suite ?? DEFAULT_SUITE;

/** Single source of truth for every endpoint under test, across all KPost modules. */
export class ApiRegistry {
  private readonly endpoints = new Map<string, EndpointDefinition>();

  register(...definitions: EndpointDefinition[]): this {
    for (const definition of definitions) {
      if (this.endpoints.has(definition.id)) {
        throw new Error(`Endpoint "${definition.id}" is already registered`);
      }
      /*
       * Uniqueness is per module, not global. KPost's modules are separate services with
       * their own hosts, and they genuinely share paths — every Spring Boot service answers
       * `GET /health`, for instance. Only a collision WITHIN one module is a mistake.
       */
      const clash = this.all().find(
        (e) =>
          suiteOf(e) === suiteOf(definition) &&
          e.method === definition.method &&
          e.path === definition.path,
      );
      if (clash) {
        throw new Error(
          `${definition.method} ${definition.path} is already registered in ${suiteOf(definition)} as "${clash.id}"`,
        );
      }
      if (!definition.path.startsWith('/')) {
        throw new Error(`Endpoint "${definition.id}": path must start with "/"`);
      }
      this.endpoints.set(definition.id, definition);
    }
    return this;
  }

  get(id: string): EndpointDefinition {
    const endpoint = this.endpoints.get(id);
    if (!endpoint) {
      throw new Error(
        `Unknown endpoint "${id}". Registered: ${[...this.endpoints.keys()].join(', ')}`,
      );
    }
    return endpoint;
  }

  has(id: string): boolean {
    return this.endpoints.has(id);
  }

  all(): EndpointDefinition[] {
    return [...this.endpoints.values()];
  }

  find(filter: EndpointFilter = {}): EndpointDefinition[] {
    return this.all().filter(
      (e) =>
        (!filter.ids || filter.ids.includes(e.id)) &&
        (!filter.methods || filter.methods.includes(e.method)) &&
        (!filter.suites || filter.suites.includes(suiteOf(e))) &&
        (!filter.tags || filter.tags.some((tag) => e.tags?.includes(tag))) &&
        (!filter.excludeTags || !filter.excludeTags.some((tag) => e.tags?.includes(tag))),
    );
  }
}
