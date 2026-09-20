import { z } from 'zod';
import registry from '../../config/run-profiles.json';

/**
 * Named execution profiles — what a run of this bench IS.
 *
 * Phase 2 §17.1. Before this, a mode lived in a `package.json` command line carrying up to 14
 * `cross-env` flags, and nothing stated what the mode meant. A profile states it once: which
 * Playwright projects run, the tag filter, the validation profile, the safety flags, the gated write
 * flows it opens, the PROVEN worker ceiling, and what it needs from the account inventory.
 *
 * ## Precedence, and why
 *
 *     command environment  >  profile  >  .env file
 *
 * The command is the operator's intent for this run, so it always wins — the same rule that keeps
 * bug filing arm-able only from a command (`resolveDryRun`). The profile beats a `.env` file because
 * a file holds an environment's standing configuration, not the intent of one run: `kpost` must mean
 * the same thing on every machine.
 *
 * ## What this module does NOT do
 *
 * It resolves and validates configuration. It reads no environment, opens no connection and mutates
 * nothing: every function takes its inputs as arguments so the whole model is testable offline. The
 * account POOL that will consume `accounts` is a later step (§17.3); in Phase 2.1 those numbers are
 * declarative only, and nothing allocates an account.
 */

const ExecutionSchema = z.object({
  /**
   * `sequential` — this mode is safe only one worker at a time (shared, single-session QA accounts).
   * `parallel-safe` — the mode touches no account and no shared host, so its ceiling is real.
   * The DEFAULT is always 1 regardless; a higher count must be asked for explicitly (§17.7).
   */
  mode: z.enum(['sequential', 'parallel-safe']),
  /** The highest worker count PROVEN safe for this mode. Asking for more is refused, not clamped. */
  maxWorkers: z.number().int().positive(),
});

const AccountsSchema = z.object({
  /**
   * PERSONAL session accounts one worker of this mode needs. DECLARATIVE in Phase 2.1 — recorded so
   * the future pool can compute `capacity = floor(configuredAccounts / sessionPerWorker)` without
   * any count being hardcoded in the framework.
   */
  sessionPerWorker: z.number().int().min(0),
  /** Business identities this mode needs by key (tiers are not interchangeable). */
  businessKeys: z.array(z.string()).default([]),
});

const ProfileSchema = z.object({
  description: z.string().min(1),
  /** offline = no host at all · mock = the bundled mock · test = the configured KPost test hosts. */
  targetKind: z.enum(['offline', 'mock', 'test']),
  /** Deep/fuzzing modes that may only ever run against a throwaway database. */
  requiresDisposableTarget: z.boolean().default(false),
  projects: z.array(z.string().min(1)).min(1),
  grep: z.string().min(1).optional(),
  testFilter: z.string().min(1).optional(),
  validationProfile: z.enum(['SMOKE', 'REGRESSION', 'SECURITY', 'FULL']).optional(),
  /** Environment this mode sets. Never a secret and never a host — hosts stay in `.env`. */
  flags: z.record(z.string(), z.string()).default({}),
  lifecycles: z.array(z.string().min(1)).default([]),
  execution: ExecutionSchema,
  accounts: AccountsSchema,
  cleanup: z.enum(['not-applicable', 'spec-managed']),
  /** `never` = cannot file at all · `command-armed` = only with `--file` · `resolve-only`. */
  filing: z.enum(['never', 'command-armed', 'resolve-only']),
});

const RegistrySchema = z.object({
  comment: z.array(z.string()).optional(),
  profiles: z.record(z.string(), ProfileSchema),
});

export type RunProfileDefinition = z.infer<typeof ProfileSchema>;
export interface RunProfile extends RunProfileDefinition {
  readonly name: string;
}

/** A host that is never a KPost test deployment, rejected before anything runs. */
const PRODUCTION_HOST = /^(https?:\/\/)?(api|account|kmail5|www)\.kpostindia\.com/i;

/**
 * A host recognisable as a test deployment: the named test hosts, anything under a `test`/`dev`
 * label, the loopback interface, or a private LAN address (the on-prem admin box).
 */
const TEST_HOST = new RegExp(
  [
    '^(https?://)?(testingapi|testkmail|test|dev|devapi\\d*|staging|qa)[.-]',
    '^(https?://)?[^/]*\\.test\\.',
    '^(https?://)?(localhost|127\\.0\\.0\\.1)',
    '^(https?://)?(192\\.168\\.|10\\.|172\\.(1[6-9]|2\\d|3[01])\\.)',
  ].join('|'),
  'i',
);

/**
 * Validates the registry ONCE, at import. A malformed profile is a configuration error that must
 * stop the run immediately, naming the field — never a mode that half-works.
 */
function loadRegistry(): Record<string, RunProfile> {
  const parsed = RegistrySchema.safeParse(registry);
  if (!parsed.success) {
    throw new Error(
      `config/run-profiles.json is malformed:\n${z.prettifyError(parsed.error)}\n` +
        'Fix the registry — a run profile cannot be partially valid.',
    );
  }
  return Object.fromEntries(
    Object.entries(parsed.data.profiles).map(([name, profile]) => [name, { ...profile, name }]),
  );
}

export const RUN_PROFILES: Readonly<Record<string, RunProfile>> = Object.freeze(loadRegistry());
export const RUN_PROFILE_NAMES: readonly string[] = Object.keys(RUN_PROFILES).sort();

/**
 * The profile with no name: every project, nothing forced. It is what a bare `npx playwright test`
 * and every legacy npm script get, so their behaviour is exactly what it was before profiles existed.
 */
export const DEFAULT_PROFILE: RunProfile = Object.freeze({
  name: 'default',
  description: 'No profile: every project, nothing forced (legacy commands and ad-hoc runs).',
  targetKind: 'offline',
  requiresDisposableTarget: false,
  projects: [],
  flags: {},
  lifecycles: [],
  execution: { mode: 'sequential', maxWorkers: 1 },
  accounts: { sessionPerWorker: 0, businessKeys: [] },
  cleanup: 'not-applicable',
  filing: 'command-armed',
}) as RunProfile;

/** The named profile, or the default when no name was given. An unknown name is an error. */
export function runProfile(name: string | undefined): RunProfile {
  if (!name) return DEFAULT_PROFILE;
  const profile = RUN_PROFILES[name];
  if (!profile) {
    throw new Error(
      `Unknown run profile "${name}". Known profiles: ${RUN_PROFILE_NAMES.join(', ')}.`,
    );
  }
  return profile;
}

/**
 * The environment a profile contributes, minus anything the COMMAND already set.
 *
 * Pure, so a test can assert exactly what `--profile kpost` resolves to. `commandEnv` is the
 * environment as it was BEFORE the `.env` files were loaded — that is what makes "command wins,
 * profile beats .env" precise rather than approximate.
 */
export function profileOverlay(
  profile: RunProfile,
  commandEnv: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const overlay: Record<string, string> = {};
  const set = (key: string, value: string): void => {
    if (commandEnv[key] === undefined || commandEnv[key] === '') overlay[key] = value;
  };

  if (profile.validationProfile) set('VALIDATION_PROFILE', profile.validationProfile);
  for (const [key, value] of Object.entries(profile.flags)) set(key, value);
  for (const gate of profile.lifecycles) set(gate, 'true');
  return overlay;
}

/** Applies the overlay to a mutable environment. Used once, by `env.ts`, before parsing. */
export function applyProfile(
  profile: RunProfile,
  commandEnv: Readonly<Record<string, string | undefined>>,
  target: Record<string, string | undefined>,
): Record<string, string> {
  const overlay = profileOverlay(profile, commandEnv);
  for (const [key, value] of Object.entries(overlay)) target[key] = value;
  return overlay;
}

/**
 * The worker count a run may use.
 *
 * The default is **1 for every profile** — a profile never silently raises parallelism, because
 * nothing yet isolates the shared QA accounts (the account pool is §17.3). A higher count must be
 * asked for explicitly and is **refused** above the proven ceiling rather than clamped: a request
 * for 8 workers on a mode that supports 1 means the operator believes something about isolation that
 * is not true, and they need to hear it rather than get a quietly different run.
 */
export function resolveWorkers(profile: RunProfile, requested: number | undefined): number {
  if (requested === undefined) return 1;
  if (!Number.isInteger(requested) || requested < 1) {
    throw new Error(`--workers must be a positive integer (got "${String(requested)}").`);
  }
  if (requested > profile.execution.maxWorkers) {
    throw new Error(
      `Profile "${profile.name}" is proven safe up to ${profile.execution.maxWorkers} worker(s); ` +
        `${requested} requested.` +
        (profile.execution.mode === 'sequential'
          ? ' This mode is SEQUENTIAL: the QA accounts are shared and single-session, and no account' +
            ' isolation exists yet (planned, docs/PHASE-2-DESIGN.md §5).'
          : '') +
        ' See docs/PHASE-2-DESIGN.md §9.',
    );
  }
  return requested;
}

export interface TargetCheck {
  /** Every configured host, by the variable that set it. Unset entries are ignored. */
  hosts: Readonly<Record<string, string | undefined>>;
  mockApi: boolean;
}

/**
 * Refuses to start when the profile and the configured target disagree.
 *
 * This runs before any test executes. It is a **check, not a switch**: no flag turns it off, and a
 * profile cannot grant itself a target it is not allowed to have. It complements — never replaces —
 * the production guard, the OTP/SMS kill-switch and the QA-identifier guard, which stay armed
 * whatever profile is selected.
 */
export function assertTargetAllowed(profile: RunProfile, check: TargetCheck): void {
  const configured = Object.entries(check.hosts)
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    // The Playwright template's placeholder BASE_URL means "no UI host configured", not a target.
    .filter(([, url]) => !/^https:\/\/playwright\.dev\/?$/i.test(url));

  const production = configured.filter(([, url]) => PRODUCTION_HOST.test(url));
  if (production.length) {
    throw new Error(
      `Profile "${profile.name}" refuses to run: ` +
        production.map(([name, url]) => `${name}=${url}`).join(', ') +
        ' looks like a PRODUCTION KPost host. This bench targets the disposable test deployment' +
        ' only. There is no flag to override this — point the host at a test deployment.',
    );
  }

  if (profile.targetKind === 'mock' && !check.mockApi) {
    throw new Error(
      `Profile "${profile.name}" runs against the bundled mock, but MOCK_API is false. ` +
        'Unset MOCK_API (or set it to true) for this profile.',
    );
  }

  if (profile.targetKind === 'test') {
    if (check.mockApi) {
      throw new Error(
        `Profile "${profile.name}" targets the configured KPost test hosts, but MOCK_API is true. ` +
          'Use the `mock` profile for a mock run.',
      );
    }
    const unknown = configured.filter(([, url]) => !TEST_HOST.test(url));
    if (unknown.length) {
      throw new Error(
        `Profile "${profile.name}" refuses to run: ` +
          unknown.map(([name, url]) => `${name}=${url}`).join(', ') +
          ' is not recognisable as a KPost TEST deployment (expected a testingapi/testkmail/test/dev' +
          ' host, localhost, or a private LAN address). A profile may not be pointed at an' +
          ' unrecognised host; use the legacy command deliberately if that host is genuinely correct,' +
          ' and record why in CLAUDE.md.',
      );
    }
  }

  if (profile.requiresDisposableTarget && profile.targetKind !== 'test') {
    throw new Error(
      `Profile "${profile.name}" fuzzes writes and requires a disposable test database, ` +
        `but its targetKind is "${profile.targetKind}".`,
    );
  }
}

/** One line per profile for `--list-profiles`; no secret, no host. */
export function describeProfiles(): string[] {
  return RUN_PROFILE_NAMES.map((name) => {
    const p = RUN_PROFILES[name];
    if (!p) return name;
    const workers =
      p.execution.mode === 'sequential'
        ? 'sequential'
        : `up to ${String(p.execution.maxWorkers)} workers`;
    return `${name.padEnd(12)} ${p.description} [${p.targetKind}, ${workers}, filing: ${p.filing}]`;
  });
}
