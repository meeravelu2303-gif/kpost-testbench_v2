import { env } from './env';

export type DatabaseClientKind = 'mock' | 'none';

/**
 * Database access for endpoint-specific DB validations. The connection string comes from the
 * environment only. Plug a real adapter (pg, mssql, ...) in src/database/database-client.ts.
 */
export const databaseConfig = {
  enabled: env.DB_ENABLED ?? env.MOCK_API,
  client: env.MOCK_API
    ? ('mock' satisfies DatabaseClientKind)
    : ('none' satisfies DatabaseClientKind),
  connectionString: env.DB_CONNECTION_STRING,
  queryTimeoutMs: 5_000,
} as const;
