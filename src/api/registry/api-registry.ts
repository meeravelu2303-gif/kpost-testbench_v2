import type { HttpMethod } from '../client/request-builder';
import type { EndpointDefinition } from './endpoint-definition';

export interface EndpointFilter {
  ids?: readonly string[];
  /** Endpoint must have at least one of these tags. */
  tags?: readonly string[];
  methods?: readonly HttpMethod[];
}

/** Single source of truth for every endpoint under test. */
export class ApiRegistry {
  private readonly endpoints = new Map<string, EndpointDefinition>();

  register(...definitions: EndpointDefinition[]): this {
    for (const definition of definitions) {
      if (this.endpoints.has(definition.id)) {
        throw new Error(`Endpoint "${definition.id}" is already registered`);
      }
      const clash = this.all().find(
        (e) => e.method === definition.method && e.path === definition.path,
      );
      if (clash) {
        throw new Error(
          `${definition.method} ${definition.path} is already registered as "${clash.id}"`,
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
        (!filter.tags || filter.tags.some((tag) => e.tags?.includes(tag))),
    );
  }
}
