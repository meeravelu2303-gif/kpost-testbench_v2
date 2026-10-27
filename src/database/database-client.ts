// Type-only, so `mysql2` loads lazily in `connect()` and runs without a database never load it.
import type { Pool as MysqlPool } from 'mysql2/promise';
import { databaseConfig, type DatabaseTarget } from '@config/database.config';
import type { SuiteId } from '@config/ownership.config';
import type { JsonObject } from '@utils/json';

/**
 * Adapter-agnostic query surface used by repositories (disabled or MySQL), so a DB validation
 * reports SKIPPED, never PASSED, where no database is configured.
 */
export interface DbQuery {
  table: string;
  where: Record<string, string | number | boolean | null>;
}

export interface DatabaseClient {
  readonly enabled: boolean;
  /** The suite whose database this client serves. Decides the connection and the write policy. */
  readonly suite: SuiteId;
  /** False on a live target; no environment variable can turn it on. */
  readonly writable: boolean;
  findOne<T extends JsonObject>(query: DbQuery, correlationId?: string): Promise<T | undefined>;
  findMany<T extends JsonObject>(query: DbQuery, correlationId?: string): Promise<T[]>;
  /** Rows matching `where`, counted in the database rather than fetched. */
  count(query: DbQuery, correlationId?: string): Promise<number>;
  /** Releases pooled connections. Safe to call on any adapter, including those that hold none. */
  dispose?(): Promise<void>;
}

/** Raw SQL inside a transaction, only on a real database (callers check `isSqlClient`). */
export interface SqlTransaction {
  query<T extends JsonObject>(text: string, params?: readonly unknown[]): Promise<T[]>;
}

/** Weakest to strongest. MySQL defaults to REPEATABLE READ; READ UNCOMMITTED allows dirty reads. */
export type IsolationLevel =
  'READ UNCOMMITTED' | 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';

export const ISOLATION_LEVELS: readonly IsolationLevel[] = [
  'READ UNCOMMITTED',
  'READ COMMITTED',
  'REPEATABLE READ',
  'SERIALIZABLE',
];

export interface SqlDatabaseClient extends DatabaseClient {
  readonly kind: 'mysql';
  query<T extends JsonObject>(
    text: string,
    params?: readonly unknown[],
    correlationId?: string,
  ): Promise<T[]>;
  /**
   * Runs `fn` in one transaction on a dedicated connection: commit on return, roll back on throw.
   */
  transaction<T>(
    fn: (tx: SqlTransaction) => Promise<T>,
    options?: { isolation?: IsolationLevel; readOnly?: boolean },
  ): Promise<T>;
}

export function isSqlClient(db: DatabaseClient): db is SqlDatabaseClient {
  return (db as Partial<SqlDatabaseClient>).kind === 'mysql';
}

/**
 * Identifiers cannot be bound as parameters, so each is matched against this pattern and
 * backtick-quoted before interpolation (no quotes, semicolons, whitespace or comment markers get
 * through).
 */
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*$/;

export function quoteIdentifier(name: string, role: string): string {
  if (!SAFE_IDENTIFIER.test(name)) {
    throw new Error(
      `Unsafe SQL ${role} "${name}": identifiers must match ${String(SAFE_IDENTIFIER)}. ` +
        'Values are bound as parameters; identifiers are never taken from untrusted input.',
    );
  }
  return `\`${name}\``;
}

/**
 * `` `database`.`table` ``, each part validated and quoted; an unqualified name resolves in the
 * connection's database.
 */
export function qualify(table: string): string {
  const parts = table.split('.');
  if (parts.length > 2) throw new Error(`Unsafe SQL table "${table}": too many qualifiers`);
  if (parts.length === 2) {
    return `${quoteIdentifier(parts[0] ?? '', 'database')}.${quoteIdentifier(parts[1] ?? '', 'table')}`;
  }
  return quoteIdentifier(parts[0] ?? '', 'table');
}

/**
 * `WHERE` clause plus bound values; `null` becomes `IS NULL`, since `column = NULL` is never true.
 */
export function buildWhere(where: DbQuery['where']): { clause: string; values: unknown[] } {
  const values: unknown[] = [];
  const terms = Object.entries(where).map(([column, value]) => {
    const quoted = quoteIdentifier(column, 'column');
    if (value === null) return `${quoted} IS NULL`;
    values.push(value);
    return `${quoted} = ?`;
  });
  return { clause: terms.length ? `WHERE ${terms.join(' AND ')}` : '', values };
}

/**
 * Statements allowed where writes are not; anything else counts as a write. `WITH` is excluded
 * because MySQL 8 allows `WITH … DELETE`, which would reach the live Admin database.
 */
const READ_ONLY_START = /^\s*(?:select|explain|describe|desc|show)\b/i;

export function isReadOnlyStatement(text: string): boolean {
  return READ_ONLY_START.test(text);
}

class DisabledDatabaseClient implements DatabaseClient {
  readonly enabled = false;
  readonly writable = false;

  constructor(
    readonly suite: SuiteId,
    private readonly reason: string,
  ) {}

  private refuse(): Promise<never> {
    return Promise.reject(new Error(this.reason));
  }

  findOne<T extends JsonObject>(): Promise<T | undefined> {
    return this.refuse();
  }

  findMany<T extends JsonObject>(): Promise<T[]> {
    return this.refuse();
  }

  count(): Promise<number> {
    return this.refuse();
  }
}

/** Real MySQL over `mysql2/promise`, loaded lazily; one pool per target, closed by `dispose()`. */
class MysqlDatabaseClient implements SqlDatabaseClient {
  readonly enabled = true;
  readonly kind = 'mysql' as const;
  readonly suite: SuiteId;
  readonly writable: boolean;

  /** Created on first use, then reused. Held as a promise so concurrent callers share one pool. */
  private pool?: Promise<MysqlPool>;

  constructor(private readonly target: DatabaseTarget) {
    this.suite = target.suite;
    this.writable = target.allowWrites;
  }

  /** Refuses a statement this target may not run, naming the target's own reason. */
  private assertPermitted(text: string): void {
    if (isReadOnlyStatement(text)) return;
    if (this.target.allowWrites) return;
    const reason =
      this.target.writeBanReason ??
      'DB_ALLOW_WRITES=false — a direct SQL write bypasses the application’s validation, permissions and audit trail';
    throw new Error(
      `Refusing a non-read statement on the ${this.suite} database: ${reason}. ` +
        `Statement: ${text.slice(0, 120)}`,
    );
  }

  private connect(): Promise<MysqlPool> {
    this.pool ??= (async (): Promise<MysqlPool> => {
      const { createPool } = await import('mysql2/promise');
      const connection = this.target.connection;
      if (!connection) throw new Error(`No MySQL connection configured for suite ${this.suite}`);
      return createPool({
        host: connection.host,
        port: connection.port,
        user: connection.user,
        password: connection.password,
        database: connection.database,
        // KPOST_QA requires TLS, so TLS off fails there with the server's own message.
        ssl: connection.tls
          ? { ca: connection.tls.ca, rejectUnauthorized: connection.tls.rejectUnauthorized }
          : undefined,
        connectionLimit: databaseConfig.poolSize,
        waitForConnections: true,
        connectTimeout: databaseConfig.queryTimeoutMs,
        // DECIMAL/BIGINT as strings, so large ids are never rounded.
        decimalNumbers: false,
        supportBigNumbers: true,
        bigNumberStrings: true,
        // One statement per call, so an injected `; DROP …` can never run.
        multipleStatements: false,
      });
    })();
    return this.pool;
  }

  async query<T extends JsonObject>(
    text: string,
    params: readonly unknown[] = [],
    _correlationId?: string,
  ): Promise<T[]> {
    this.assertPermitted(text);
    const pool = await this.connect();
    const [rows] = await pool.query({ sql: text, timeout: databaseConfig.queryTimeoutMs }, [
      ...params,
    ]);
    return (Array.isArray(rows) ? rows : []) as T[];
  }

  async findMany<T extends JsonObject>(query: DbQuery, correlationId?: string): Promise<T[]> {
    const { clause, values } = buildWhere(query.where);
    return this.query<T>(`SELECT * FROM ${qualify(query.table)} ${clause}`, values, correlationId);
  }

  async findOne<T extends JsonObject>(
    query: DbQuery,
    correlationId?: string,
  ): Promise<T | undefined> {
    const { clause, values } = buildWhere(query.where);
    const rows = await this.query<T>(
      `SELECT * FROM ${qualify(query.table)} ${clause} LIMIT 1`,
      values,
      correlationId,
    );
    return rows[0];
  }

  async count(query: DbQuery, correlationId?: string): Promise<number> {
    const { clause, values } = buildWhere(query.where);
    const rows = await this.query<{ count: string | number }>(
      `SELECT COUNT(*) AS count FROM ${qualify(query.table)} ${clause}`,
      values,
      correlationId,
    );
    // COUNT() is a BIGINT, returned as a string by the settings above so large values survive.
    return Number(rows[0]?.count ?? 0);
  }

  async transaction<T>(
    fn: (tx: SqlTransaction) => Promise<T>,
    options: { isolation?: IsolationLevel; readOnly?: boolean } = {},
  ): Promise<T> {
    const pool = await this.connect();
    const connection = await pool.getConnection();
    const isolation = options.isolation ?? 'REPEATABLE READ';
    // SET TRANSACTION takes no parameters, so the level is validated before interpolation.
    if (!ISOLATION_LEVELS.includes(isolation)) {
      throw new Error(`Unknown isolation level "${isolation}"`);
    }
    // Read-only by default; Admin can never reach a READ WRITE transaction.
    const readOnly = options.readOnly ?? !this.target.allowWrites;

    try {
      // The access mode belongs on START TRANSACTION; on SET TRANSACTION it stays writable.
      await connection.query(`SET TRANSACTION ISOLATION LEVEL ${isolation}`);
      await connection.query(`START TRANSACTION ${readOnly ? 'READ ONLY' : 'READ WRITE'}`);

      const tx: SqlTransaction = {
        query: async <R extends JsonObject>(text: string, params: readonly unknown[] = []) => {
          // Checked per statement, so a READ WRITE transaction cannot bypass the write policy.
          this.assertPermitted(text);
          const [rows] = await connection.query(
            { sql: text, timeout: databaseConfig.queryTimeoutMs },
            [...params],
          );
          return (Array.isArray(rows) ? rows : []) as R[];
        },
      };

      const value = await fn(tx);
      await connection.query('COMMIT');
      return value;
    } catch (error) {
      // Best-effort: the connection may already be dead, and the original error is the useful one.
      await connection.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  }

  async dispose(): Promise<void> {
    const pool = await this.pool?.catch(() => undefined);
    await pool?.end();
    this.pool = undefined;
  }
}

/** The client for one suite's database; prefer `DatabasePool`, which caches and disposes them. */
export function createDatabaseClient(suite: SuiteId): DatabaseClient {
  const target = databaseConfig.forSuite(suite);
  switch (target.kind) {
    case 'mysql':
      return new MysqlDatabaseClient(target);
    case 'none':
      return new DisabledDatabaseClient(
        suite,
        databaseConfig.enabled
          ? `No database is configured for the ${suite} suite: set its connection variables ` +
              `(DB_HOST/DB_NAME, or ADMIN_DB_HOST/ADMIN_DB_NAME for admin-api). ` +
              'DB validations report SKIPPED rather than passing without having queried anything.'
          : 'Database access is disabled (DB_ENABLED=false). DB validations report SKIPPED rather ' +
              'than passing without having queried anything.',
      );
  }
}
