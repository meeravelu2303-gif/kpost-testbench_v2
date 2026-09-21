import { readFileSync } from 'node:fs';
import type { SuiteId } from './ownership.config';
import { env } from './env';

export type DatabaseClientKind = 'mock' | 'mysql' | 'none';

/**
 * Which database each suite talks to, and what it is allowed to do there.
 *
 * ## Why this is per-suite and not one connection
 *
 * KPost and KMail run against **KPOST_QA**, a disposable test database where writes, transaction
 * experiments and row-count assertions are all fair game. The **Admin module runs against a live
 * production database**. Those are not the same risk, so they cannot share one configuration: a
 * single `allowWrites` flag governing both would mean the switch that unlocks a useful test on
 * KPOST_QA also unlocks a destructive one on live Admin data.
 *
 * So the write permission is a property of the *target*, not of the run.
 *
 * ## The Admin ban is in code, not in configuration
 *
 * `WRITE_BANNED_SUITES` cannot be overridden by any environment variable, including
 * `DB_ALLOW_WRITES=true`. This mirrors how the production endpoint allowlist already works, and for
 * the same reason: an environment variable is inherited from a shell, a CI job or a stale `.env`,
 * and the failure it would cause here — an unaudited write into live Admin data, through a path
 * with none of the application's validation or permission checks — cannot be undone.
 *
 * Admin also gets its **own** connection variables (`ADMIN_DB_*`). Pointing Admin at the test
 * database, or the KPost suites at the live one, has to be a deliberate edit rather than a default
 * quietly shared between them.
 */

/** Suites whose database is a live production system. Writes are refused, always. */
const WRITE_BANNED_SUITES: ReadonlySet<SuiteId> = new Set<SuiteId>(['admin-api']);

export interface MysqlTls {
  /** PEM contents of the server's CA, when one was supplied. */
  ca?: string;
  /** False keeps the connection encrypted but stops authenticating the server. */
  rejectUnauthorized: boolean;
}

export interface MysqlConnection {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  /** Undefined disables TLS entirely; the KPOST_QA server refuses that. */
  tls?: MysqlTls;
}

export interface DatabaseTarget {
  /** Which suite's data this connection holds. */
  suite: SuiteId;
  kind: DatabaseClientKind;
  /** Undefined for `mock` and `none`. */
  connection?: MysqlConnection;
  /** Non-SELECT SQL permitted. False on every live target, whatever the environment says. */
  allowWrites: boolean;
  /** Why writes are refused, when they are. Shown in the refusal so the reason travels with it. */
  writeBanReason?: string;
}

const hasKpostConnection = Boolean(env.DB_HOST && env.DB_NAME);
const hasAdminConnection = Boolean(env.ADMIN_DB_HOST && env.ADMIN_DB_NAME);

/*
 * `DB_ENABLED` overrides in both directions. Left unset, the database is used when something is
 * genuinely reachable — the mock, or a configured connection.
 */
const enabled = env.DB_ENABLED ?? (env.MOCK_API || hasKpostConnection);

/** Reads a CA file once, at configuration time, so a bad path fails loudly rather than per query. */
function readCa(path: string | undefined, variable: string): string | undefined {
  if (!path) return undefined;
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(`${variable} points at "${path}", which could not be read`, { cause: error });
  }
}

function mysqlConnection(scope: 'kpost' | 'admin'): MysqlConnection | undefined {
  const source =
    scope === 'admin'
      ? {
          host: env.ADMIN_DB_HOST,
          port: env.ADMIN_DB_PORT,
          user: env.ADMIN_DB_USER,
          password: env.ADMIN_DB_PASSWORD,
          database: env.ADMIN_DB_NAME,
          ssl: env.ADMIN_DB_SSL,
          ca: readCa(env.ADMIN_DB_SSL_CA, 'ADMIN_DB_SSL_CA'),
          rejectUnauthorized: env.ADMIN_DB_SSL_REJECT_UNAUTHORIZED,
        }
      : {
          host: env.DB_HOST,
          port: env.DB_PORT,
          user: env.DB_USER,
          password: env.DB_PASSWORD,
          database: env.DB_NAME,
          ssl: env.DB_SSL,
          ca: readCa(env.DB_SSL_CA, 'DB_SSL_CA'),
          rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED,
        };
  if (!source.host || !source.database) return undefined;
  return {
    host: source.host,
    port: source.port,
    user: source.user ?? '',
    password: source.password ?? '',
    database: source.database,
    tls: source.ssl
      ? {
          ca: source.ca,
          /*
           * A supplied CA is the point of supplying one, so it implies verification: it would be
           * silently pointless to read a CA file and then not check the chain against it.
           */
          rejectUnauthorized: source.ca ? true : source.rejectUnauthorized,
        }
      : undefined,
  };
}

function targetFor(suite: SuiteId): DatabaseTarget {
  const banned = WRITE_BANNED_SUITES.has(suite);
  const writeBanReason = banned
    ? `the ${suite} database is a LIVE production system; writes are refused in code and DB_ALLOW_WRITES does not apply to it`
    : undefined;

  if (!enabled) return { suite, kind: 'none', allowWrites: false, writeBanReason };

  // The mock serves every suite: it is the bench's own store, and nothing in it is real.
  if (env.MOCK_API || env.DB_TYPE === 'mock') {
    return { suite, kind: 'mock', allowWrites: !banned && env.DB_ALLOW_WRITES, writeBanReason };
  }

  const connection = mysqlConnection(banned ? 'admin' : 'kpost');
  if (!connection) return { suite, kind: 'none', allowWrites: false, writeBanReason };

  return {
    suite,
    kind: 'mysql',
    connection,
    // The ban wins over the flag. This is the single line the Admin guarantee rests on.
    allowWrites: banned ? false : env.DB_ALLOW_WRITES,
    writeBanReason,
  };
}

export const databaseConfig = {
  enabled,
  /** Connections held open per target. Must exceed the concurrency burst size. */
  poolSize: env.DB_POOL_SIZE,
  queryTimeoutMs: env.DB_STATEMENT_TIMEOUT_MS,
  /** True when a suite's database is a live production system. */
  isWriteBanned: (suite: SuiteId): boolean => WRITE_BANNED_SUITES.has(suite),
  writeBannedSuites: WRITE_BANNED_SUITES,
  /** Everything a client needs to serve one suite. */
  forSuite: targetFor,
  /** Whether an Admin connection has been configured at all (it is optional and separate). */
  hasAdminConnection,
} as const;
