import { randomUUID } from 'node:crypto';
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';
import { ROOT_DIR, VALIDATION_PROFILES } from './constants';

const testEnv = process.env.TEST_ENV || 'local';

// Earlier files win, and dotenv never overrides variables already set (e.g. CI secrets),
// so precedence is: process env > .env.<TEST_ENV> > .env
dotenv.config({
  path: [path.join(ROOT_DIR, `.env.${testEnv}`), path.join(ROOT_DIR, '.env')],
  quiet: true,
});

// Generated once in the Playwright main process; workers inherit it, so every worker,
// log line and report entry of one run shares the same ID.
process.env.TEST_RUN_ID ||= `run-${randomUUID()}`;

const EnvSchema = z.object({
  TEST_ENV: z.enum(['local', 'dev', 'qa', 'staging', 'production']).default('local'),
  BASE_URL: z.url().default('https://playwright.dev'),
  /**
   * The Admin/HR-Setup UI origin (`kpostadmin.kpostindia.com`), a SEPARATE front end from the main
   * KPost app (`BASE_URL`). Backed by `ADMIN_API_BASE_URL` (adminmodule). SSO: the same KPost login
   * token is planted in this origin's localStorage (`accessToken` + `AuthUser` + `companyID`), the
   * way the app's own `Callback.js` does. Only the `admin-ui` Playwright project uses it.
   */
  ADMIN_UI_BASE_URL: z.url().optional(),
  API_BASE_URL: z.url().optional(),
  /**
   * Per-module API base URLs. KPost is one product built from separately maintained modules
   * that are deployed independently, so each suite targets its own host. Unset falls back to
   * API_BASE_URL (which is the bundled mock API locally).
   */
  KPOST_API_BASE_URL: z.url().optional(),
  ADMIN_API_BASE_URL: z.url().optional(),
  KMAIL_API_BASE_URL: z.url().optional(),
  /**
   * The path prefix KMail serves under, prepended to every KMail request path (the base URL is the
   * origin — Playwright drops a base-URL path for an absolute request path). Prod is `/kmail5/v2`;
   * the test host `testkmail.kpostindia.com` serves under `/testkmail/v2`. Set it to match the host,
   * or every KMail call 404s and reads as a false bug.
   */
  KMAIL_PATH_PREFIX: z.string().default('/kmail5/v2'),
  /** Start and target the bundled mock KPost API. Defaults to on for `local` without API_BASE_URL. */
  MOCK_API: z.stringbool().optional(),
  MOCK_API_PORT: z.coerce.number().int().positive().default(4010),

  APP_USERNAME: z.string().optional(),
  APP_PASSWORD: z.string().optional(),
  /** JSON array of API principals: [{ key, role, tenantId?, username, password }] */
  AUTH_PRINCIPALS: z.string().optional(),
  /** A genuinely expired token for the target environment (optional; mock mode generates one). */
  EXPIRED_TOKEN: z.string().optional(),
  /** Tenant/company used for data created by tests (mock mode uses the seeded company). */
  TEST_COMPANY_ID: z.string().optional(),

  /**
   * Force database access on or off. Unset, it follows what is reachable: the mock's store under
   * `MOCK_API=true`, a real MySQL when `DB_HOST`/`DB_NAME` are set, otherwise nothing.
   */
  DB_ENABLED: z.stringbool().optional(),
  /** `mysql` is the only real engine KPost runs on; `mock` is the bundled in-memory store. */
  DB_TYPE: z.enum(['mysql', 'mock']).default('mysql'),
  /**
   * MySQL host. A JDBC URL (`jdbc:mysql://host:3306`) is accepted and reduced to its host, because
   * that is the form the connection details are normally handed over in — see `mysqlHost()` below.
   */
  DB_HOST: z.string().optional(),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().optional(),
  DB_PASSWORD: z.string().optional(),
  /** Database (schema) name — in MySQL these are the same thing. */
  DB_NAME: z.string().optional(),
  /** Pooled connections. Must exceed the concurrency burst size, or the bench throttles itself. */
  DB_POOL_SIZE: z.coerce.number().int().positive().default(10),
  /** Per-statement timeout; a query outliving it is abandoned and reported as a failed check. */
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  /**
   * TLS for the MySQL connection. On by default, and the KPOST_QA server enforces it
   * (`--require_secure_transport=ON`), so a plaintext attempt is refused before it authenticates.
   */
  DB_SSL: z.stringbool().default(true),
  /**
   * Path to the server's CA certificate (PEM). Supply this when the server presents a private or
   * self-signed certificate, which is what makes verification possible rather than skipped.
   */
  DB_SSL_CA: z.string().optional(),
  /**
   * Verify the server's certificate chain. **Leave this on.**
   *
   * Turning it off keeps the connection encrypted but stops authenticating the server, so anything
   * positioned between the bench and the database can present its own certificate and read the
   * credentials in the handshake. That matters here because the host is a public address, not a
   * machine on a private network. It exists as an escape hatch for a self-signed server whose CA
   * has not been handed over yet — the fix is `DB_SSL_CA`, not living with this off.
   */
  DB_SSL_REJECT_UNAUTHORIZED: z.stringbool().default(true),
  /**
   * Permit non-SELECT SQL on the KPost/KMail **test** database.
   *
   * Default deny: a direct write bypasses the application's own validation, permissions and audit
   * trail, so it is a separate decision from `ALLOW_DESTRUCTIVE_TESTS`. It has **no effect on the
   * Admin database**, which is a live production system and is write-banned in code — see
   * `src/config/database.config.ts`.
   */
  DB_ALLOW_WRITES: z.stringbool().default(false),

  /*
   * ---- Admin module database (SEPARATE, and LIVE) ----------------------------------------------
   *
   * The Admin module runs against a production database while KPost/KMail run against KPOST_QA, so
   * it gets its own connection rather than sharing one. These are deliberately distinct variables:
   * pointing Admin at the test DB, or the KPost suites at the live one, must take an explicit edit
   * rather than an inherited default.
   *
   * Writes are refused on this connection regardless of `DB_ALLOW_WRITES`, so there is no
   * combination of environment variables that lets the bench write to live Admin data.
   */
  ADMIN_DB_HOST: z.string().optional(),
  ADMIN_DB_PORT: z.coerce.number().int().positive().default(3306),
  ADMIN_DB_USER: z.string().optional(),
  ADMIN_DB_PASSWORD: z.string().optional(),
  ADMIN_DB_NAME: z.string().optional(),
  ADMIN_DB_SSL: z.stringbool().default(true),
  ADMIN_DB_SSL_CA: z.string().optional(),
  /** Certificate verification for the LIVE Admin database. Turning this off is a worse idea here. */
  ADMIN_DB_SSL_REJECT_UNAUTHORIZED: z.stringbool().default(true),

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
  /**
   * Auto-close a bench-filed bug that this run VERIFIED as fixed — its exact endpoint+validator ran
   * and passed, and the fault did not reproduce. Marked RESOLVED/FIXED with a comment. Default on;
   * it only acts on a real filing run (never a dry run) and never touches a human-judged resolution.
   */
  BUGZILLA_AUTO_RESOLVE: z.stringbool().default(true),
  /**
   * Resolve-only: close the verified-fixed bugs but do NOT file or comment new ones. For a pass that
   * only reconciles "what the developers already fixed" without adding tickets yet.
   */
  BUGZILLA_RESOLVE_ONLY: z.stringbool().default(false),

  VALIDATION_PROFILE: z.enum(VALIDATION_PROFILES).default('REGRESSION'),
  ALLOW_DESTRUCTIVE_TESTS: z.stringbool().default(false),
  /**
   * The target is a throwaway TEST DATABASE, so the full test-type matrix (injection, XSS,
   * rate-limit, performance, every fuzzer) may run on READ endpoints. The QA-identifier guard and the
   * OTP/SMS kill-switch stay armed regardless; writes stay covered by the self-cleaning lifecycle
   * flows. Off by default — only set it when the host genuinely points at a test DB.
   */
  TEST_DB_MODE: z.stringbool().default(false),
  /**
   * Deep write-fuzzing: run the engine's fuzzers/attack probes directly on `data`-side-effect WRITE
   * endpoints (not just reads), so bad input, injection and malformed payloads are tested on writes
   * too. This PERSISTS junk into the schema, so it is only for a disposable test DB — it requires
   * `TEST_DB_MODE=true`, never unlocks `external`/`global`/OTP writes, and the QA-guard stays armed.
   */
  WRITE_FUZZ: z.stringbool().default(false),
  /**
   * The target env's OTP subsystem is a **TEST GATEWAY** — `sendOTP`/`sendOTPtoMail` create the OTP
   * record but deliver **no real SMS/e-mail**, and `123456` (`QA_BYPASS_OTP`) always validates. When
   * set together with `TEST_DB_MODE=true`, it lifts the OTP/SMS kill-switch for `otpDependent`
   * endpoints ONLY (signup, registration, device designation, forgot-password, deactivate, validate),
   * so those flows run end to end on the disposable test DB. It changes nothing for a non-`otpDependent`
   * endpoint, and the QA-identifier guard stays armed. **Set it ONLY when the OTP gateway is genuinely a
   * test gateway** — against a real gateway it would send real messages. Off by default.
   */
  OTP_TEST_GATEWAY: z.stringbool().default(false),

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
const mockApi = data.MOCK_API ?? (data.TEST_ENV === 'local' && !data.API_BASE_URL);

/**
 * Reduces a MySQL host setting to a bare host and, when the value carries one, a port.
 *
 * Connection details are usually handed over as a JDBC URL — `jdbc:mysql://db.example:3306` —
 * because that is what the application's own configuration holds. Passing that string to a driver
 * as a hostname produces a DNS failure whose message says nothing about the real cause, so it is
 * normalized here, once, at the edge.
 *
 * A port inside the URL that **disagrees** with the separate `*_DB_PORT` variable throws rather
 * than picking a winner. Either choice would be a guess about which the author meant, and a bench
 * silently connecting to a different port than its configuration states is the kind of fault that
 * gets diagnosed as "the database is down".
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

const kpostDb = parseMysqlHost(data.DB_HOST, data.DB_PORT, 'DB_HOST');
const adminDb = parseMysqlHost(data.ADMIN_DB_HOST, data.ADMIN_DB_PORT, 'ADMIN_DB_HOST');

export const env = Object.freeze({
  ...data,
  MOCK_API: mockApi,
  API_BASE_URL:
    data.API_BASE_URL ?? (mockApi ? `http://127.0.0.1:${data.MOCK_API_PORT}` : data.BASE_URL),
  IS_PRODUCTION: data.TEST_ENV === 'production',
  BUILD_ID: data.BUILD_ID ?? data.GITHUB_RUN_NUMBER ?? 'local',
  // Normalized above, so everything downstream sees a host a driver can actually resolve.
  DB_HOST: kpostDb.host,
  DB_PORT: kpostDb.port,
  ADMIN_DB_HOST: adminDb.host,
  ADMIN_DB_PORT: adminDb.port,
});

export type Env = typeof env;
