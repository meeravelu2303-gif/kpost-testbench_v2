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
  API_BASE_URL: z.url().optional(),
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

  VALIDATION_PROFILE: z.enum(VALIDATION_PROFILES).default('REGRESSION'),
  ALLOW_DESTRUCTIVE_TESTS: z.stringbool().default(false),

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

export const env = Object.freeze({
  ...data,
  MOCK_API: mockApi,
  API_BASE_URL:
    data.API_BASE_URL ?? (mockApi ? `http://127.0.0.1:${data.MOCK_API_PORT}` : data.BASE_URL),
  IS_PRODUCTION: data.TEST_ENV === 'production',
  BUILD_ID: data.BUILD_ID ?? data.GITHUB_RUN_NUMBER ?? 'local',
});

export type Env = typeof env;
