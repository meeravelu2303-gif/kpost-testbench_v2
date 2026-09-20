import { randomUUID } from 'node:crypto';
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';
import { ROOT_DIR, VALIDATION_PROFILES } from './constants';
import { applyProfile, assertTargetAllowed, runProfile } from './run-profiles';

const testEnv = process.env.TEST_ENV || 'local';

/*
 * Bug filing may only be ARMED by the command that starts the run (a `:file` npm script, CI) —
 * never by a value sitting in a `.env` file, where it silently turns every ad-hoc
 * `npx playwright test` or IDE run into a live filing run. So the value is captured from the real
 * process environment BEFORE dotenv loads the files; a `false` that only a file supplied is ignored.
 */
const dryRunFromCommand = process.env.BUGZILLA_DRY_RUN;

/*
 * The environment as the COMMAND supplied it, captured before any file is loaded. Both the dry-run
 * rule above and the run profile below need to tell "the operator asked for this" apart from "a file
 * happened to contain it".
 */
const commandEnv: Readonly<Record<string, string | undefined>> = { ...process.env };

// Earlier files win, and dotenv never overrides variables already set (e.g. CI secrets),
// so precedence is: process env > .env.<TEST_ENV> > .env
dotenv.config({
  path: [path.join(ROOT_DIR, `.env.${testEnv}`), path.join(ROOT_DIR, '.env')],
  quiet: true,
});

/*
 * Apply the named run profile (docs/COMMANDS.md, docs/PHASE-2-DESIGN.md §8). It fills in what the
 * command did not state and overrides the `.env` files, so a mode means the same thing on every
 * machine. With no RUN_PROFILE — every legacy npm script, and a bare `npx playwright test` — the
 * default profile contributes nothing and behaviour is exactly what it was before profiles existed.
 */
const activeProfile = runProfile(process.env.RUN_PROFILE);
const appliedProfileEnv = applyProfile(activeProfile, commandEnv, process.env);

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

  DB_ENABLED: z.stringbool().optional(),
  DB_CONNECTION_STRING: z.string().optional(),

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

  /** Named execution profile (config/run-profiles.json); set by `scripts/bench.cjs`. */
  RUN_PROFILE: z.string().optional(),
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

  // ---- Gated write flows. Each gate opens one module's self-cleaning lifecycle spec, which writes
  // real data on the target (messages, calls, mails, org records …). All default OFF; the per-suite
  // npm commands (docs/COMMANDS.md) switch on the ones they run. Declared here — not read ad hoc as
  // `process.env.X === 'true'` — so every run switch is typed, documented and in `.env.example`.
  /** API lifecycle: Admin/HR org build on BUSINESS_M (tests/api/admin/feature.spec.ts). */
  ADMIN_LIFECYCLE: z.stringbool().default(false),
  /**
   * Admin role posting — mints a real KPost + KSMACC account that cannot be deleted. Above
   * ADMIN_LIFECYCLE, owner-authorized only.
   */
  ADMIN_ROLE_POSTING_LIVE: z.stringbool().default(false),
  AWS_LIFECYCLE: z.stringbool().default(false),
  CONTACTS_LIFECYCLE: z.stringbool().default(false),
  GROUP_LIFECYCLE: z.stringbool().default(false),
  KALL_LIFECYCLE: z.stringbool().default(false),
  KATCHUP_LIFECYCLE: z.stringbool().default(false),
  KDIARY_LIFECYCLE: z.stringbool().default(false),
  KMAIL_LIFECYCLE: z.stringbool().default(false),
  KOS_LIFECYCLE: z.stringbool().default(false),
  /** K-AI generation calls a real, BILLED AI service. Above KOS_LIFECYCLE, owner-authorized only. */
  KOS_AI_LIVE: z.stringbool().default(false),
  PROFILE_LIFECYCLE: z.stringbool().default(false),
  SETTINGS_LIFECYCLE: z.stringbool().default(false),
  /** UI write flows (tests/e2e) — each drives its module's screens against the real app. */
  ADMIN_UI_LIFECYCLE: z.stringbool().default(false),
  BUSINESS_UI_LIFECYCLE: z.stringbool().default(false),
  CONTACTS_UI_LIFECYCLE: z.stringbool().default(false),
  GROUP_UI_LIFECYCLE: z.stringbool().default(false),
  KALL_UI_LIFECYCLE: z.stringbool().default(false),
  KATCHUP_UI_LIFECYCLE: z.stringbool().default(false),
  KDIARY_UI_LIFECYCLE: z.stringbool().default(false),
  KMAIL_UI_LIFECYCLE: z.stringbool().default(false),
  LOGIN_UI_LIFECYCLE: z.stringbool().default(false),
  PROFILE_UI_LIFECYCLE: z.stringbool().default(false),
  SETTINGS_UI_LIFECYCLE: z.stringbool().default(false),
  /** Pixel-baseline comparison (tests/e2e/visual.spec.ts); needs committed baselines. */
  VISUAL_REGRESSION: z.stringbool().default(false),

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

/** Every variable the schema reads (TEST_RUN_ID is generated) — `.env.example` must document each. */
export const ENV_SCHEMA_KEYS: readonly string[] = Object.keys(EnvSchema.shape).filter(
  (key) => key !== 'TEST_RUN_ID',
);

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
 * The effective dry-run setting. Filing is armed only when the COMMAND's own environment says
 * `BUGZILLA_DRY_RUN=false`; a `false` that only a `.env` file supplied is overruled (`forced`).
 */
export function resolveDryRun(
  configured: boolean,
  fromCommand: string | undefined,
): { dryRun: boolean; forced: boolean } {
  const forced = !configured && fromCommand === undefined;
  return { dryRun: configured || forced, forced };
}

const dryRun = resolveDryRun(data.BUGZILLA_DRY_RUN, dryRunFromCommand);
// Written back so Playwright workers, which inherit process.env, agree with the main process.
if (dryRun.forced) process.env.BUGZILLA_DRY_RUN = 'true';
const filingArmedByFile = dryRun.forced;

/*
 * The environment guard for a PROFILED run: a profile may not be pointed at a production-looking
 * host, nor at a target its kind forbids. It runs HERE — at configuration load, before any test
 * executes — and no flag turns it off.
 *
 * It deliberately does NOT apply to the `default` profile, which is what every legacy npm command and
 * every ad-hoc `npx playwright test` use: Phase 2.1 is additive and may not change what an existing
 * command does. Those paths keep the protections they always had (the production guard, the OTP/SMS
 * kill-switch and the QA-identifier guard, all unchanged). Extending the host check to them is a
 * deliberate behaviour change and needs its own approval.
 */
if (activeProfile.name !== 'default') {
  assertTargetAllowed(activeProfile, {
    hosts: {
      KPOST_API_BASE_URL: data.KPOST_API_BASE_URL,
      KMAIL_API_BASE_URL: data.KMAIL_API_BASE_URL,
      ADMIN_API_BASE_URL: data.ADMIN_API_BASE_URL,
      API_BASE_URL: data.API_BASE_URL,
      BASE_URL: data.BASE_URL,
      ADMIN_UI_BASE_URL: data.ADMIN_UI_BASE_URL,
    },
    mockApi,
  });
}

export const env = Object.freeze({
  ...data,
  /** The resolved run profile — what this run IS. Consumers read it instead of guessing from flags. */
  PROFILE: activeProfile,
  RUN_PROFILE: activeProfile.name,
  /** What the profile contributed (command-supplied values are absent). Reported, never secret. */
  PROFILE_ENV: Object.freeze(appliedProfileEnv),
  BUGZILLA_DRY_RUN: dryRun.dryRun,
  /** True when a `.env` file set BUGZILLA_DRY_RUN=false and it was ignored (reported once per run). */
  BUGZILLA_DRY_RUN_FORCED: filingArmedByFile,
  MOCK_API: mockApi,
  API_BASE_URL:
    data.API_BASE_URL ?? (mockApi ? `http://127.0.0.1:${data.MOCK_API_PORT}` : data.BASE_URL),
  IS_PRODUCTION: data.TEST_ENV === 'production',
  BUILD_ID: data.BUILD_ID ?? data.GITHUB_RUN_NUMBER ?? 'local',
});

export type Env = typeof env;
