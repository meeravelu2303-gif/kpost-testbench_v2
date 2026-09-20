import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '@config/constants';
import {
  assertTargetAllowed,
  DEFAULT_PROFILE,
  describeProfiles,
  profileOverlay,
  resolveWorkers,
  runProfile,
  RUN_PROFILE_NAMES,
  RUN_PROFILES,
  type RunProfile,
} from '@config/run-profiles';
import { expect, test } from '@fixtures';

/**
 * Guards for Phase 2 §17.1 — named run profiles and the unified runner.
 *
 * Everything here is offline: pure resolution functions plus the runner's `--print` mode, which
 * prints the command it WOULD run and executes nothing. No KPost host is contacted.
 */

const NO_COMMAND_ENV: Record<string, string | undefined> = {};

/** The runner, in print-only mode — it resolves and validates, then exits without running tests. */
function bench(args: string[]): { status: number; output: string } {
  try {
    const output = execFileSync('node', [path.join(ROOT_DIR, 'scripts', 'bench.cjs'), ...args], {
      cwd: ROOT_DIR,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? 1,
      output: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
    };
  }
}

test.describe('run profiles: resolution @framework', () => {
  test('a known profile resolves, with its name attached', () => {
    const profile = runProfile('kpost');
    expect(profile.name).toBe('kpost');
    expect(profile.projects).toEqual(['api']);
    expect(profile.grep).toBe('@kpost-api');
    expect(profile.validationProfile).toBe('FULL');
  });

  test('no profile means the default: every project, nothing forced', () => {
    expect(runProfile(undefined)).toBe(DEFAULT_PROFILE);
    expect(DEFAULT_PROFILE.projects).toEqual([]);
    expect(profileOverlay(DEFAULT_PROFILE, NO_COMMAND_ENV)).toEqual({});
  });

  test('an unknown profile fails, naming the known ones', () => {
    expect(() => runProfile('kpsot')).toThrow(/Unknown run profile "kpsot"/);
    expect(() => runProfile('kpsot')).toThrow(/Known profiles: /);
  });

  test('the registry validates at import — every profile is complete and typed', () => {
    expect(RUN_PROFILE_NAMES.length).toBeGreaterThan(0);
    const all = RUN_PROFILE_NAMES.map((name) => RUN_PROFILES[name] as RunProfile);
    expect(all.filter((p) => !p.description).map((p) => p.name)).toEqual([]);
    expect(all.filter((p) => p.projects.length === 0).map((p) => p.name)).toEqual([]);
    expect(all.filter((p) => p.execution.maxWorkers < 1).map((p) => p.name)).toEqual([]);
    // A mode that cannot isolate accounts must not advertise a parallel ceiling.
    const overclaiming = all
      .filter((p) => p.execution.mode === 'sequential' && p.execution.maxWorkers !== 1)
      .map((p) => p.name);
    expect(overclaiming, 'a sequential profile must have a ceiling of exactly 1').toEqual([]);
  });

  test('no misleading profile exists for a capability the repository lacks', () => {
    // @smoke is on exactly one endpoint today, so a `smoke` profile would run almost nothing.
    expect(RUN_PROFILE_NAMES).not.toContain('smoke');
    expect(RUN_PROFILE_NAMES).not.toContain('sanity');
  });

  test('profiles declare account needs without any hardcoded inventory size', () => {
    // Declarative only in Phase 2.1 — the pool that consumes this is a later step.
    expect(RUN_PROFILES.kpost?.accounts.sessionPerWorker).toBe(4);
    expect(RUN_PROFILES.admin?.accounts.businessKeys).toEqual(['business-m']);
    const source = readFileSync(path.join(ROOT_DIR, 'src/config/run-profiles.ts'), 'utf8');
    expect(source, 'the framework must not hardcode an account inventory size').not.toMatch(
      /\b(six|6)\s+accounts\b/i,
    );
  });
});

test.describe('run profiles: environment precedence @framework', () => {
  test('the profile fills in what the command did not state', () => {
    const overlay = profileOverlay(runProfile('kpost'), NO_COMMAND_ENV);
    expect(overlay.VALIDATION_PROFILE).toBe('FULL');
    expect(overlay.TEST_DB_MODE).toBe('true');
    expect(overlay.OTP_TEST_GATEWAY).toBe('true');
    expect(overlay.KATCHUP_LIFECYCLE).toBe('true');
  });

  test('the command always wins over the profile', () => {
    const overlay = profileOverlay(runProfile('kpost'), {
      TEST_DB_MODE: 'false',
      VALIDATION_PROFILE: 'REGRESSION',
    });
    expect(overlay.TEST_DB_MODE, 'command value is left alone').toBeUndefined();
    expect(overlay.VALIDATION_PROFILE).toBeUndefined();
    expect(overlay.KATCHUP_LIFECYCLE, 'the rest still applies').toBe('true');
  });

  test('a profile never arms bug filing by itself', () => {
    for (const name of RUN_PROFILE_NAMES) {
      const overlay = profileOverlay(RUN_PROFILES[name] as RunProfile, NO_COMMAND_ENV);
      expect(overlay.BUGZILLA_DRY_RUN, `${name} must not arm filing`).toBeUndefined();
    }
  });
});

test.describe('run profiles: worker semantics @framework', () => {
  test('the default is one worker for every profile — never silently raised', () => {
    for (const name of RUN_PROFILE_NAMES) {
      expect(resolveWorkers(RUN_PROFILES[name] as RunProfile, undefined), name).toBe(1);
    }
  });

  test('a request within the proven ceiling is respected exactly', () => {
    expect(resolveWorkers(runProfile('framework'), 4)).toBe(4);
    expect(resolveWorkers(runProfile('mock'), 4)).toBe(4);
  });

  test('a request above the ceiling is REFUSED, not clamped', () => {
    expect(() => resolveWorkers(runProfile('kpost'), 2)).toThrow(/proven safe up to 1 worker/);
    expect(() => resolveWorkers(runProfile('kpost'), 2)).toThrow(/SEQUENTIAL/);
    expect(() => resolveWorkers(runProfile('framework'), 9)).toThrow(/proven safe up to 8/);
  });

  test('a nonsensical worker count fails', () => {
    expect(() => resolveWorkers(runProfile('framework'), 0)).toThrow(/positive integer/);
    expect(() => resolveWorkers(runProfile('framework'), 1.5)).toThrow(/positive integer/);
  });
});

test.describe('run profiles: target safety @framework', () => {
  const testHosts = {
    KPOST_API_BASE_URL: 'https://testingapi.kpostindia.com',
    KMAIL_API_BASE_URL: 'https://testkmail.kpostindia.com',
    ADMIN_API_BASE_URL: 'http://192.168.0.38:9595',
    BASE_URL: 'https://test.kpostindia.com/',
  };

  test('a recognised test deployment is allowed', () => {
    expect(() =>
      assertTargetAllowed(runProfile('kpost'), { hosts: testHosts, mockApi: false }),
    ).not.toThrow();
  });

  test('a production-looking host is refused, with no way to override', () => {
    for (const host of [
      'https://api.kpostindia.com',
      'https://account.kpostindia.com',
      'https://kmail5.kpostindia.com',
    ]) {
      expect(
        () =>
          assertTargetAllowed(runProfile('kpost'), {
            hosts: { ...testHosts, KPOST_API_BASE_URL: host },
            mockApi: false,
          }),
        host,
      ).toThrow(/PRODUCTION KPost host/);
    }
  });

  test('an unrecognised host is refused rather than assumed safe', () => {
    expect(() =>
      assertTargetAllowed(runProfile('kpost'), {
        hosts: { KPOST_API_BASE_URL: 'https://somewhere-else.example.com' },
        mockApi: false,
      }),
    ).toThrow(/not recognisable as a KPost TEST deployment/);
  });

  test('a profile cannot be pointed at the wrong kind of target', () => {
    expect(() =>
      assertTargetAllowed(runProfile('kpost'), { hosts: testHosts, mockApi: true }),
    ).toThrow(/targets the configured KPost test hosts, but MOCK_API is true/);
    expect(() => assertTargetAllowed(runProfile('mock'), { hosts: {}, mockApi: false })).toThrow(
      /runs against the bundled mock, but MOCK_API is false/,
    );
  });

  test('the host check applies to PROFILED runs only — legacy commands are untouched', () => {
    /*
     * Phase 2.1 is additive: the `default` profile is what every legacy npm command and every ad-hoc
     * `npx playwright test` use, so the new check must not change what they do. env.ts therefore
     * calls this only for a named profile; those paths keep the production guard, the OTP/SMS
     * kill-switch and the QA-identifier guard, which are unchanged.
     */
    const envSource = readFileSync(path.join(ROOT_DIR, 'src/config/env.ts'), 'utf8');
    expect(envSource).toMatch(
      /if \(activeProfile\.name !== 'default'\) \{\s*\n\s*assertTargetAllowed/,
    );
    // And the default profile has nothing of its own to enforce.
    expect(DEFAULT_PROFILE.targetKind).toBe('offline');
    expect(DEFAULT_PROFILE.projects).toEqual([]);
  });

  test('the Playwright placeholder BASE_URL is treated as "no host configured"', () => {
    expect(() =>
      assertTargetAllowed(runProfile('kpost'), {
        hosts: { ...testHosts, BASE_URL: 'https://playwright.dev' },
        mockApi: false,
      }),
    ).not.toThrow();
  });
});

test.describe('unified runner @framework', () => {
  test('--list-profiles prints every profile and exits cleanly', () => {
    const result = bench(['--list-profiles']);
    expect(result.status).toBe(0);
    for (const name of RUN_PROFILE_NAMES) expect(result.output).toContain(name);
  });

  test('--print resolves the run without executing any test', () => {
    const result = bench(['--profile', 'kpost', '--print']);
    expect(result.status).toBe(0);
    expect(result.output).toContain('profile "kpost"');
    expect(result.output).toContain('playwright test');
    expect(result.output).toContain('--workers=1');
  });

  test('an unknown profile fails before anything runs', () => {
    const result = bench(['--profile', 'nope', '--print']);
    expect(result.status).toBe(2);
    expect(result.output).toContain('Unknown profile "nope"');
    expect(result.output).not.toContain('playwright test');
  });

  test('a missing --profile fails with usage', () => {
    const result = bench(['--print']);
    expect(result.status).toBe(2);
    expect(result.output).toContain('--profile is required');
  });

  test('--workers above the profile ceiling fails before anything runs', () => {
    const result = bench(['--profile', 'kpost', '--workers', '4', '--print']);
    expect(result.status).toBe(2);
    expect(result.output).toContain('proven safe up to 1 worker');
    expect(result.output).not.toContain('playwright test');
  });

  test('--file is refused for a profile that may never file', () => {
    const result = bench(['--profile', 'framework', '--file', '--print']);
    expect(result.status).toBe(2);
    expect(result.output).toContain('never files bugs');
  });

  test('--file is accepted for a filing-capable profile and arms nothing else', () => {
    const result = bench(['--profile', 'kpost', '--file', '--print']);
    expect(result.status).toBe(0);
    expect(result.output).toContain('filing ARMED');
  });

  test('the runner prints no secret and no host', () => {
    const result = bench(['--profile', 'kpost', '--print']);
    expect(result.output).not.toMatch(/password|api[_-]?key|token|kpostindia\.com/i);
  });
});

test.describe('backward compatibility @framework', () => {
  const scripts = (
    JSON.parse(readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    }
  ).scripts;

  test('every legacy command still exists and is unchanged in shape', () => {
    for (const name of [
      'kpost',
      'kpost:file',
      'kpost:deep',
      'kmail',
      'kmail:deep',
      'admin',
      'admin:deep',
      'ui',
      'all',
      'resolve',
      'check',
      'test:framework',
    ]) {
      expect(scripts[name], `npm run ${name} must still exist`).toBeTruthy();
    }
    // The legacy commands keep setting their own flags: they do NOT go through a profile yet, so
    // their behaviour cannot have changed in this phase.
    expect(scripts.kpost).toContain('playwright test --project=api --grep @kpost-api');
    expect(scripts.kpost).not.toContain('RUN_PROFILE');
  });

  test('the new runner is additive', () => {
    expect(scripts.bench).toBe('node scripts/bench.cjs');
  });

  /**
   * The equivalence guard: a profile must resolve to the same environment its legacy command sets.
   * This is what allows the legacy scripts to be switched over later without a behaviour change —
   * and fails the build the day the two drift.
   */
  test('each profile resolves to the environment its legacy command sets', () => {
    const cases: [string, string][] = [
      ['kpost', 'kpost'],
      ['kpost:deep', 'kpost-deep'],
      ['kmail', 'kmail'],
      ['kmail:deep', 'kmail-deep'],
      ['admin', 'admin'],
      ['admin:deep', 'admin-deep'],
      ['ui', 'ui'],
    ];

    for (const [script, profileName] of cases) {
      const command = scripts[script] ?? '';
      // Flags the legacy command sets, minus BUGZILLA_* (filing is a command decision, not a mode).
      const legacy = new Map<string, string>(
        [...command.matchAll(/([A-Z][A-Z0-9_]*)=(\S+)/g)]
          .map((match): [string, string] => [match[1] ?? '', match[2] ?? ''])
          .filter(([key, value]) => key && value && !key.startsWith('BUGZILLA_')),
      );

      const overlay = profileOverlay(runProfile(profileName), NO_COMMAND_ENV);
      const missing = [...legacy.entries()].filter(([key, value]) => overlay[key] !== value);
      const extra = Object.entries(overlay).filter(([key, value]) => legacy.get(key) !== value);
      expect(missing, `${profileName} is missing flags that npm run ${script} sets`).toEqual([]);
      expect(extra, `${profileName} sets flags npm run ${script} does not`).toEqual([]);
    }
  });

  test('describeProfiles() is report-safe (names and intent only)', () => {
    const lines = describeProfiles().join('\n');
    expect(lines).not.toMatch(/password|api[_-]?key|token|https?:\/\//i);
  });
});
