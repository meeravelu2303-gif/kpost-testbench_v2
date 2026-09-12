import type { APIRequest, APIRequestContext } from '@playwright/test';
import type { Logger } from '@utils/logger';
import { ApiClient } from './api-client';

/**
 * One HTTP client per KPost module.
 *
 * The modules are deployed separately (KPost core, Admin, KMail each have their own host), so a
 * single base URL cannot serve them. Contexts are created lazily — a run that only touches
 * KMail never opens a connection to the others — and disposed together.
 */
/**
 * The pool needs only a key, a label and a host - not a whole `SuiteOwnership`. Keeping the
 * parameter this narrow is what lets a bench mock fixture reuse the pool under its own key
 * (`kpost-api:mock`) without inventing a fake module in the ownership config, which would then
 * need a Bugzilla product and a developer to own it.
 */
export interface ClientTarget {
  id: string;
  label: string;
  baseUrl: string;
}

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
