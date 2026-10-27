import type { APIRequest, APIRequestContext } from '@playwright/test';
import type { Logger } from '@utils/logger';
import { ApiClient } from './api-client';

/**
 * What the pool needs to open a client: a key, a label and a host (narrow, so a mock can reuse it).
 */
export interface ClientTarget {
  id: string;
  label: string;
  baseUrl: string;
}

/** One HTTP client per module host, created lazily and disposed together. */
export class ApiClientPool {
  private readonly clients = new Map<string, { client: ApiClient; context: APIRequestContext }>();

  constructor(
    private readonly request: APIRequest,
    private readonly log: Logger,
  ) {}

  async get(suite: ClientTarget): Promise<ApiClient> {
    const existing = this.clients.get(suite.id);
    if (existing) return existing.client;

    const context = await this.request.newContext({ baseURL: suite.baseUrl });
    const client = new ApiClient(context, this.log.child({ suite: suite.id }));
    this.clients.set(suite.id, { client, context });
    this.log.debug(`opened client for ${suite.label} at ${suite.baseUrl}`);
    return client;
  }

  async dispose(): Promise<void> {
    for (const { context } of this.clients.values()) await context.dispose();
    this.clients.clear();
  }
}
