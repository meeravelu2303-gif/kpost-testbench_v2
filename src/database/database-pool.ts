import type { SuiteId } from '@config/ownership.config';
import { createDatabaseClient, type DatabaseClient } from './database-client';

/**
 * One database client per suite, since KPOST_QA and the live Admin DB need different write
 * policies. Clients open lazily and are disposed together.
 */
export class DatabasePool {
  private readonly clients = new Map<SuiteId, DatabaseClient>();

  /** The client serving this suite, created on first use. */
  for(suite: SuiteId): DatabaseClient {
    const existing = this.clients.get(suite);
    if (existing) return existing;
    const client = createDatabaseClient(suite);
    this.clients.set(suite, client);
    return client;
  }

  async dispose(): Promise<void> {
    for (const client of this.clients.values()) await client.dispose?.();
    this.clients.clear();
  }
}
