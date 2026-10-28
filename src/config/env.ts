import { randomUUID } from 'node:crypto';
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';
import { ROOT_DIR, VALIDATION_PROFILES } from './constants';
import { applyQatestOnly } from './qatest-only';

const testEnv = process.env.TEST_ENV || 'local';

// Earlier files win, and dotenv never overrides variables already set (e.g. CI secrets),
// so precedence is: process env > .env.<TEST_ENV> > .env
dotenv.config({
  path: [path.join(ROOT_DIR, `.env.${testEnv}`), path.join(ROOT_DIR, '.env')],
  quiet: true,
});

// QATEST_ONLY=true re-points the QA_* accounts at qatest1..6 (see qatest-only.ts) before they are read.
applyQatestOnly();

// Generated once in the Playwright main process; workers inherit it, so every worker,
// log line and report entry of one run shares the same ID.
process.env.TEST_RUN_ID ||= `run-${randomUUID()}`;

const EnvSchema = z.object({
  TEST_ENV: z.enum(['local', 'dev', 'qa', 'staging', 'production']).default('local'),
  /** The KPost front end under test: the TEST deployment only. */
  BASE_URL: z.url().default('https://test.kpostindia.com'),
  /** The Admin/HR-Setup UI origin, a separate front end; used only by the `admin-ui` project. */
  ADMIN_UI_BASE_URL: z.url().optional(),
  API_BASE_URL: z.url().optional(),
  /**
   * Per-module API base URLs (each module deploys separately); unset falls back to API_BASE_URL.
   */
  KPOST_API_BASE_URL: z.url().optional(),
  ADMIN_API_BASE_URL: z.url().optional(),
  KMAIL_API_BASE_URL: z.url().optional(),
  /**
   * Path prefix for every KMail request (Playwright drops a base-URL path); must match the host.
   * Unset, it follows `KMAIL_API_BASE_URL` (`kmailPathPrefix` below).
   */
  KMAIL_PATH_PREFIX: z.string().optional(),

  APP_USERNAME: z.string().optional(),
  APP_PASSWORD: z.string().optional(),
  /** JSON array of API principals: [{ key, role, tenantId?, username, password }] */
  AUTH_PRINCIPALS: z.string().optional(),
  /** A genuinely expired token for the target environment (optional). */
  EXPIRED_TOKEN: z.string().optional(),
  /** Tenant/company used for data created by tests. */
  TEST_COMPANY_ID: z.string().optional(),

  /** Force database access on or off; unset, MySQL is used when `DB_HOST`/`DB_NAME` are set. */
  DB_ENABLED: z.stringbool().optional(),
  /** MySQL host; a JDBC URL is accepted and reduced to its host (`parseMysqlHost`). */
  DB_HOST: z.string().optional(),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().optional(),
  DB_PASSWORD: z.string().optional(),
  /** Database (schema) name. */
  DB_NAME: z.string().optional(),
  /** Pooled connections. Must exceed the concurrency burst size, or the bench throttles itself. */
  DB_POOL_SIZE: z.coerce.number().int().positive().default(10),
  /** Per-statement timeout; a query outliving it is abandoned and reported as a failed check. */
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  /** TLS for the MySQL connection; the server requires it. */
  DB_SSL: z.stringbool().default(true),
  /** Path to the server's CA certificate (PEM), for a private or self-signed certificate. */
  DB_SSL_CA: z.string().optional(),
  /**
   * Verify the server's certificate chain. Leave on; for a self-signed server set `DB_SSL_CA`
   * instead.
   */
  DB_SSL_REJECT_UNAUTHORIZED: z.stringbool().default(true),
  /**
   * Permit non-SELECT SQL on the KPost/KMail test DB. No effect on the Admin DB, which is
   * write-banned in code.
   */
  DB_ALLOW_WRITES: z.stringbool().default(false),

  // ---- Admin module database: separate and LIVE; writes are refused whatever the flags say.
  ADMIN_DB_HOST: z.string().optional(),
  ADMIN_DB_PORT: z.coerce.number().int().positive().default(3306),
  ADMIN_DB_USER: z.string().optional(),
  ADMIN_DB_PASSWORD: z.string().optional(),
  ADMIN_DB_NAME: z.string().optional(),
  ADMIN_DB_SSL: z.stringbool().default(true),
  ADMIN_DB_SSL_CA: z.string().optional(),
  /** Certificate verification for the live Admin database. */
  ADMIN_DB_SSL_REJECT_UNAUTHORIZED: z.stringbool().default(true),
  /**
   * The Admin backend's MongoDB store, read-only; unset, Admin cross-layer checks are SKIPPED.
   * Never logged.
   */
  ADMIN_MONGO_URI: z.string().optional(),
  ADMIN_MONGO_DB: z.string().default('admin_enterprise'),

  // ---- Bugzilla bug filing (see src/config/bugzilla.config.ts)
  /** REST root, e.g. http://192.168.0.50/rest. Unset disables filing entirely. */
  BUGZILLA_URL: z.url().optional(),
  BUGZILLA_API_KEY: z.string().optional(),
  /** Filing is irreversible, so the default is a dry run that only reports what it would file. */
  BUGZILLA_DRY_RUN: z.stringbool().default(true),
  /** Lowest severity that may become a ticket. */
  BUGZILLA_MIN_SEVERITY: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).default('MEDIUM'),
  /** Safety valve for a staged rollout: file at most N bugs per run (0 = no cap). */
  BUGZILLA_MAX_FILE: z.coerce.number().int().min(0).default(0),
  /** File failures from the browser (UI) suites as well. */
  BUGZILLA_FILE_UI_FAILURES: z.stringbool().default(true),
  /** File accessibility findings, one ticket per rule across all screens. */
  BUGZILLA_FILE_ACCESSIBILITY: z.stringbool().default(true),
  /** Auto-close a bench-filed bug whose own check passed this run (real filing runs only). */
  BUGZILLA_AUTO_RESOLVE: z.stringbool().default(true),
  /** Close verified-fixed bugs but file or comment nothing new. */
  BUGZILLA_RESOLVE_ONLY: z.stringbool().default(false),

  /** Concurrency probes (simultaneous bursts); false turns them all off whatever the profile. */
  CONCURRENCY_PROBES: z.stringbool().default(true),

  VALIDATION_PROFILE: z.enum(VALIDATION_PROFILES).default('REGRESSION'),
  ALLOW_DESTRUCTIVE_TESTS: z.stringbool().default(false),
  /** The target is a disposable test DB, so the full validator matrix may run on read endpoints. */
  TEST_DB_MODE: z.stringbool().default(false),
  /** Fuzz `data` write endpoints too. It persists junk, so it requires TEST_DB_MODE. */
  WRITE_FUZZ: z.stringbool().default(false),
  /**
   * The OTP gateway is a test gateway (no real SMS, `123456` validates). With TEST_DB_MODE it lifts
   * the OTP kill-switch for `otpDependent` endpoints only. Never set it against a real gateway.
   */
  OTP_TEST_GATEWAY: z.stringbool().default(false),
  /**
   * Lets the self-cleaning admin lifecycle spec send `global` admin writes; also needs its per-call
   * `allowGlobalLifecycle`.
   */
  ADMIN_LIFECYCLE: z.stringbool().default(false),
  /**
   * Run the role-posting lifecycle (writes to live KSMACC), QA companies only; the engine never
   * fuzzes it.
   */
  ADMIN_ROLE_POSTING_LIVE: z.stringbool().default(false),

  HEADLESS: z.stringbool().default(true),
  WORKERS: z.coerce.number().int().positive().optional(),
  RETRIES: z.coerce.number().int().min(0).optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  LOG_FORMAT: z.enum(['pretty', 'json']).default('pretty'),
  CI: z.stringbool().default(false),
  BUILD_ID: z.string().optional(),
  GITHUB_RUN_NUMBER: z.string().optional(),
  TEST_RUN_ID: z.string(),
});

// Treat empty values (`KEY=` in .env files) as unset so defaults apply; accept `prod` as an alias.
const rawEnv: Record<string, string | undefined> = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => value !== ''),
);
if (rawEnv.TEST_ENV === 'prod') rawEnv.TEST_ENV = 'production';

const parsed = EnvSchema.safeParse(rawEnv);
if (!parsed.success) {
  throw new Error(
    `Invalid environment configuration (TEST_ENV=${testEnv}):\n${z.prettifyError(parsed.error)}`,
  );
}

const data = parsed.data;

/**
 * Reduces a MySQL host setting (bare host or JDBC URL) to host and port; throws if a URL port
 * disagrees with `*_DB_PORT`.
 */
export function parseMysqlHost(
  value: string | undefined,
  port: number,
  variable: string,
): { host?: string; port: number } {
  if (!value) return { port };

  // Strip a scheme (`jdbc:mysql://`, `mysql://`) and anything from the first path/query separator.
  const withoutScheme = value.replace(/^[a-z+]+:(?:\/\/)?/i, '').replace(/^mysql:\/\//i, '');
  const authority = withoutScheme.split(/[/?]/)[0] ?? '';

  // IPv6 literals are bracketed, so only split on a colon that is not inside brackets.
  const match = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(authority);
  if (!match) return { host: authority || undefined, port };

  const host = match[1];
  const embedded = match[2] ? Number(match[2]) : undefined;

  if (embedded !== undefined && embedded !== port) {
    throw new Error(
      `${variable} specifies port ${embedded} but ${variable.replace(/HOST$/, 'PORT')} is ${port}. ` +
        'Remove the port from the host, or make the two agree — the bench will not guess which you meant.',
    );
  }

  return { host: host || undefined, port: embedded ?? port };
}

/**
 * KMail's path prefix: testkmail sits behind a gateway at `/testkmail/v2`; a KMail server reached
 * directly (e.g. `http://192.168.0.100:9081`) serves its controllers at `/v2`. With the old fixed
 * default, a direct server answered 404 to every request.
 */
export function kmailPathPrefix(explicit: string | undefined, baseUrl: string | undefined): string {
  if (explicit) return explicit;
  if (!baseUrl) return '/testkmail/v2';
  return new URL(baseUrl).hostname === 'testkmail.kpostindia.com' ? '/testkmail/v2' : '/v2';
}

const kpostDb = parseMysqlHost(data.DB_HOST, data.DB_PORT, 'DB_HOST');
const adminDb = parseMysqlHost(data.ADMIN_DB_HOST, data.ADMIN_DB_PORT, 'ADMIN_DB_HOST');

export const env = Object.freeze({
  ...data,
  API_BASE_URL: data.API_BASE_URL ?? data.BASE_URL,
  KMAIL_PATH_PREFIX: kmailPathPrefix(data.KMAIL_PATH_PREFIX, data.KMAIL_API_BASE_URL),
  IS_PRODUCTION: data.TEST_ENV === 'production',
  BUILD_ID: data.BUILD_ID ?? data.GITHUB_RUN_NUMBER ?? 'local',
  // Normalized above, so everything downstream sees a host a driver can actually resolve.
  DB_HOST: kpostDb.host,
  DB_PORT: kpostDb.port,
  ADMIN_DB_HOST: adminDb.host,
  ADMIN_DB_PORT: adminDb.port,
});

export type Env = typeof env;
