import type { APIRequestContext } from '@playwright/test';
/*
 * Type-only, so it is erased at compile time and `mysql2` is still loaded lazily at runtime by the
 * dynamic import inside `connect()`. A value import here would pull the driver into every run,
 * including the ones that never touch a database.
 */
import type { Pool as MysqlPool } from 'mysql2/promise';
import { databaseConfig, type DatabaseTarget } from '@config/database.config';
import type { SuiteId } from '@config/ownership.config';
import { isPlainObject, type JsonObject } from '@utils/json';

/**
 * Minimal, adapter-agnostic query surface used by repositories. Validators never talk to the
 * database; DB validations use repositories, repositories use this client.
 *
 * Three adapters implement it — the disabled one, the mock server's in-memory store, and real
 * MySQL — so a DB validation is written once and runs wherever its suite is pointed.
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
  /**
   * Rows matching `where`, counted in the database rather than fetched and measured here.
   *
   * The duplicate-write race is the reason this is a first-class operation: proving that two
   * simultaneous writes produced one row means counting rows, and `findMany().length` would pull
   * every matching record across the wire to do it.
   */
  count(query: DbQuery, correlationId?: string): Promise<number>;
  /** Releases pooled connections. Safe to call on any adapter, including those that hold none. */
  dispose?(): Promise<void>;
}

/**
 * Raw SQL, available only on a real database.
 *
 * `DbQuery` is deliberately too simple for transaction-isolation work: proving that one
 * transaction cannot see another's uncommitted row needs two connections held open across several
 * statements, which no table/where pair can express. Rather than inflate the shared interface with
 * operations the mock cannot honour, that power lives here and callers test for it — so a probe
 * that needs real transactions reports SKIPPED against the mock instead of silently checking
 * something weaker.
 */
export interface SqlTransaction {
  query<T extends JsonObject>(text: string, params?: readonly unknown[]): Promise<T[]>;
}

/**
 * Ordered from weakest to strongest. MySQL/InnoDB supports all four and defaults to REPEATABLE
 * READ — unlike PostgreSQL, READ UNCOMMITTED is a real level here and genuinely permits dirty
 * reads, so it is spelled out rather than silently promoted.
 */
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
   * Runs `fn` inside one transaction on one dedicated connection, committing on return and rolling
   * back on throw. Two of these running at once is how an isolation level is actually tested.
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
 * A MySQL identifier the bench is willing to interpolate.
 *
 * Table and column names cannot be bound as parameters — MySQL only parameterizes values — so they
 * are the one part of a statement built by concatenation. Every one is matched against this pattern
 * and then backtick-quoted, which is the combination that makes it safe: the pattern admits no
 * backtick, quote, semicolon, whitespace or comment marker, and the quoting stops a
 * legal-but-surprising name (a reserved word such as `order`, or a name differing only in case)
 * from changing the statement's meaning.
 *
 * Identifiers reach here from endpoint definitions and repositories, not from API responses. The
 * check exists anyway, because "the input is trusted" is the assumption behind most injections.
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
 * `` `database`.`table` ``, each part validated and backtick-quoted.
 *
 * An unqualified name is left unqualified: the connection is opened against a specific database, so
 * MySQL resolves it there. Prefixing it with a configured schema the way PostgreSQL needs would be
 * wrong here — in MySQL the database *is* the schema, and it is already chosen by the connection.
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
 * `WHERE` clause plus its bound values, using MySQL's positional `?` placeholders.
 *
 * `null` becomes `IS NULL` rather than `= ?`, because `column = NULL` is never true in SQL and
 * would silently return no rows — turning "this field was cleared, as expected" into "the record
 * does not exist", which is a different and much more alarming test failure. MySQL's `<=>`
 * null-safe operator would also work, but `IS NULL` is what a developer reading the filed bug
 * expects to see.
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
 * Statements the bench may run on a target where writes are not permitted.
 *
 * `WITH` is deliberately **absent**, unlike the PostgreSQL version this replaced. MySQL 8 allows a
 * common table expression to head an `UPDATE` or `DELETE` (`WITH x AS (...) DELETE FROM ...`), so
 * treating a `WITH` prefix as proof of a read would let a write through on the live Admin database
 * — precisely the statement this gate exists to stop. A read that genuinely needs a CTE can be
 * written as a subquery; refusing a legitimate read is recoverable, and the other mistake is not.
 *
 * Default-deny for the same reason the production endpoint allowlist is: anything unrecognised,
 * including a statement type added by a future MySQL release, is treated as a write.
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

/** Reads the mock API's in-memory store through its test-only data endpoint. */
class MockDatabaseClient implements DatabaseClient {
  readonly enabled = true;

  constructor(
    readonly suite: SuiteId,
    readonly writable: boolean,
    private readonly request: APIRequestContext,
  ) {}

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

  async count(query: DbQuery, correlationId?: string): Promise<number> {
    return (await this.findMany(query, correlationId)).length;
  }
}

/**
 * Real MySQL over `mysql2/promise`.
 *
 * The driver is imported lazily so that a run which never touches a database — most of them — does
 * not load it. One pool per target, closed by `dispose()`.
 */
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

  /**
   * Refuses a statement this target may not run.
   *
   * The message carries the *reason* rather than just the rule, because the two refusals mean very
   * different things: on KPOST_QA it means "set DB_ALLOW_WRITES if you meant this", and on Admin it
   * means "this is a live database and no flag will change that".
   */
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
        /*
         * The KPOST_QA server runs with `--require_secure_transport=ON`, so a plaintext connection
         * is refused before authentication. `undefined` (TLS off) is therefore a configuration
         * error there rather than a fallback, and is left to fail with the server's own message.
         */
        ssl: connection.tls
          ? { ca: connection.tls.ca, rejectUnauthorized: connection.tls.rejectUnauthorized }
          : undefined,
        connectionLimit: databaseConfig.poolSize,
        waitForConnections: true,
        connectTimeout: databaseConfig.queryTimeoutMs,
        // Keep DECIMAL/BIGINT as strings rather than lossy numbers; the callers that need a number
        // convert explicitly, and an id silently rounded by IEEE-754 is a bug nobody finds twice.
        decimalNumbers: false,
        supportBigNumbers: true,
        bigNumberStrings: true,
        // Never allow more than one statement per call: it is the control that stops an injected
        // `; DROP ...` from ever being a second statement, independently of the identifier check.
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
    /*
     * Validated against the union rather than interpolated as given: it is the one place a
     * caller-supplied string reaches the statement text, since SET TRANSACTION takes no parameters.
     */
    if (!ISOLATION_LEVELS.includes(isolation)) {
      throw new Error(`Unknown isolation level "${isolation}"`);
    }
    // Read-only unless the target permits writes AND the caller asked for them, so the default on
    // every connection is the safe one and Admin can never reach a READ WRITE transaction.
    const readOnly = options.readOnly ?? !this.target.allowWrites;

    try {
      /*
       * MySQL needs these as two statements, and the access mode belongs on START TRANSACTION —
       * `SET TRANSACTION ISOLATION LEVEL ... READ ONLY` is not the same thing and would leave the
       * transaction writable. Getting this pair wrong is how a "read-only" probe writes.
       */
      await connection.query(`SET TRANSACTION ISOLATION LEVEL ${isolation}`);
      await connection.query(`START TRANSACTION ${readOnly ? 'READ ONLY' : 'READ WRITE'}`);

      const tx: SqlTransaction = {
        query: async <R extends JsonObject>(text: string, params: readonly unknown[] = []) => {
          /*
           * Checked per statement, not once at START: opening a READ WRITE transaction must not
           * become a way around the target's write policy.
           */
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

/**
 * The client for one suite's database.
 *
 * Prefer `DatabasePool` (`src/database/database-pool.ts`) — it caches one client per suite and
 * disposes them together. This is the factory underneath it.
 */
export function createDatabaseClient(suite: SuiteId, request: APIRequestContext): DatabaseClient {
  const target = databaseConfig.forSuite(suite);
  switch (target.kind) {
    case 'mock':
      return new MockDatabaseClient(suite, target.allowWrites, request);
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
