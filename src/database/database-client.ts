import type { APIRequestContext } from '@playwright/test';
import { databaseConfig } from '@config/database.config';
import { isPlainObject, type JsonObject } from '@utils/json';

/**
 * Minimal, adapter-agnostic query surface used by repositories. Validators never talk to the
 * database; DB validations use repositories, repositories use this client.
 *
 * To target a real database, implement this interface with your driver (e.g. `pg`), build the
 * SQL from `DbQuery` with parameters (never string concatenation) and return it from
 * `createDatabaseClient()` when `databaseConfig.client` selects it.
 */
export interface DbQuery {
  table: string;
  where: Record<string, string | number | boolean | null>;
}

export interface DatabaseClient {
  readonly enabled: boolean;
  findOne<T extends JsonObject>(query: DbQuery, correlationId?: string): Promise<T | undefined>;
  findMany<T extends JsonObject>(query: DbQuery, correlationId?: string): Promise<T[]>;
}

class DisabledDatabaseClient implements DatabaseClient {
  readonly enabled = false;

  findOne<T extends JsonObject>(): Promise<T | undefined> {
    return Promise.reject(new Error('Database access is disabled (DB_ENABLED=false)'));
  }

  findMany<T extends JsonObject>(): Promise<T[]> {
    return Promise.reject(new Error('Database access is disabled (DB_ENABLED=false)'));
  }
}

/** Reads the mock API's in-memory store through its test-only data endpoint. */
class MockDatabaseClient implements DatabaseClient {
  readonly enabled = true;

  constructor(private readonly request: APIRequestContext) {}

  async findOne<T extends JsonObject>(
    query: DbQuery,
    correlationId?: string,
  ): Promise<T | undefined> {
    return (await this.findMany<T>(query, correlationId))[0];
  }

  async findMany<T extends JsonObject>(query: DbQuery, correlationId?: string): Promise<T[]> {
    const params = Object.fromEntries(Object.entries(query.where).map(([k, v]) => [k, String(v)]));
    const response = await this.request.get(`/__test/db/${encodeURIComponent(query.table)}`, {
      params,
      headers: correlationId ? { 'x-correlation-id': correlationId } : {},
      timeout: databaseConfig.queryTimeoutMs,
    });
    if (!response.ok())
      throw new Error(`Mock DB query on "${query.table}" failed with ${response.status()}`);
    const body: unknown = await response.json();
    const rows = isPlainObject(body) && Array.isArray(body.rows) ? body.rows : [];
    return rows.filter(isPlainObject) as T[];
  }
}

export function createDatabaseClient(request: APIRequestContext): DatabaseClient {
  if (!databaseConfig.enabled) return new DisabledDatabaseClient();
  switch (databaseConfig.client) {
    case 'mock':
      return new MockDatabaseClient(request);
    case 'none':
      return new DisabledDatabaseClient();
  }
}
