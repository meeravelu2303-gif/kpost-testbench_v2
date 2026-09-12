import type { APIRequest, APIRequestContext } from '@playwright/test';
import type { SuiteOwnership } from '@config/ownership.config';
import type { Logger } from '@utils/logger';
import { ApiClient } from './api-client';

/**
 * One HTTP client per KPost module.
 *
 * The modules are deployed separately (KPost core, Admin, KMail each have their own host), so a
 * single base URL cannot serve them. Contexts are created lazily — a run that only touches
 * KMail never opens a connection to the others — and disposed together.
 */
export class ApiClientPool {
  private readonly clients = new Map<string, { client: ApiClient; context: APIRequestContext }>();

  constructor(
    private readonly request: APIRequest,
    private readonly log: Logger,
  ) {}

  async get(suite: SuiteOwnership): Promise<ApiClient> {
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
