import type { APIRequestContext } from '@playwright/test';
import type { SuiteId } from '@config/ownership.config';
import { createDatabaseClient, type DatabaseClient } from './database-client';

/**
 * One database client per suite, mirroring `ApiClientPool`.
 *
 * The suites do not share a database: KPost and KMail run against KPOST_QA, a disposable test
 * database, while Admin runs against a live production system. Holding one client for the whole run
 * would mean one connection and one write policy for both — and the write policy is precisely the
 * thing that must differ.
 *
 * Clients are created lazily, so a run that only touches KMail never opens a connection to Admin's
 * database at all, and disposed together at the end of the test.
 */
export class DatabasePool {
  private readonly clients = new Map<SuiteId, DatabaseClient>();

  constructor(private readonly request: APIRequestContext) {}

  /** The client serving this suite, created on first use. */
  for(suite: SuiteId): DatabaseClient {
    const existing = this.clients.get(suite);
    if (existing) return existing;
    const client = createDatabaseClient(suite, this.request);
    this.clients.set(suite, client);
    return client;
  }

  async dispose(): Promise<void> {
    for (const client of this.clients.values()) await client.dispose?.();
    this.clients.clear();
  }
}
