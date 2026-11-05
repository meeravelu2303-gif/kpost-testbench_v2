import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@fixtures';

/**
 * Only a real blocker may stop a test (owner, 2026-10-27). These run a small Playwright project for
 * real, in a child process, and read its JSON results: a failed step no longer skips the steps after
 * it, a step that needs a missing record is BLOCKED with a reason, and a failed setup login stops only
 * the tests that use that login.
 */

interface Outcome {
  title: string;
  status: string;
  skipReason?: string;
}

/**
 * Runs one throwaway Playwright project in test-results-continuity/ (gitignored; Playwright ignores test
 * files inside a folder named test-results) and returns each test's outcome.
 */
function runProject(name: string, files: Record<string, string>): Outcome[] {
  const dir = path.join('test-results-continuity', `${name}-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const [file, text] of Object.entries(files)) writeFileSync(path.join(dir, file), text);
  const report = path.resolve(dir, 'report.json');
  // The child is its own run: drop the parent's worker variables, keep the shared run id.
  const childEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) => !/^(TEST_WORKER_INDEX|TEST_PARALLEL_INDEX|PW_)/.test(k),
    ),
  );
  try {
    execFileSync(
      process.execPath,
      [require.resolve('@playwright/test/cli'), 'test', '-c', path.join(dir, 'pw.config.ts')],
      {
        env: {
          ...childEnv,
          PLAYWRIGHT_JSON_OUTPUT_NAME: report,
          TEST_RUN_ID: `${process.env.TEST_RUN_ID}-${name}`,
        },
        stdio: 'pipe',
      },
    );
  } catch {
    // A failing test makes the child exit non-zero; the deliberate failure is part of the proof.
  }
  const json = JSON.parse(readFileSync(report, 'utf8')) as {
    suites: unknown[];
  };
  const out: Outcome[] = [];
  const walk = (suite: { suites?: unknown[]; specs?: unknown[] }): void => {
    for (const spec of (suite.specs ?? []) as {
      title: string;
      tests: {
        results: { status: string }[];
        annotations: { type: string; description?: string }[];
      }[];
    }[]) {
      for (const t of spec.tests) {
        const last = t.results[t.results.length - 1];
        out.push({
          title: spec.title,
          status: last?.status ?? 'skipped',
          skipReason: t.annotations.find((a) => a.type === 'skip')?.description,
        });
      }
    }
    for (const child of (suite.suites ?? []) as { suites?: unknown[]; specs?: unknown[] }[])
      walk(child);
  };
  for (const suite of json.suites as { suites?: unknown[]; specs?: unknown[] }[]) walk(suite);
  rmSync(dir, { recursive: true, force: true });
  // Leave no empty parent behind (it is gitignored, but the repo root stays clean).
  if (!readdirSync(path.dirname(dir)).length)
    rmSync(path.dirname(dir), { recursive: true, force: true });
  return out;
}

const status = (outcomes: Outcome[]): Record<string, string> =>
  Object.fromEntries(outcomes.map((o) => [o.title, o.status]));

test.describe('a run tests everything a real blocker does not stop @framework', () => {
  test.describe.configure({ timeout: 120_000 });

  test('an ordered flow: a failed step skips nothing; a missing record blocks only what needs it', () => {
    const outcomes = runProject('flow', {
      'pw.config.ts': `import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: '.', workers: 1, retries: 0, reporter: [['json']] });`,
      'flow.spec.ts': `import { test, expect } from '@fixtures';
import { flowState, needs } from '../../tests/support/flow-state';
test.describe('flow', () => {
  test.describe.configure({ mode: 'default' });
  const flow = flowState<{ id: number; never: number }>('proof');
  test('1 create', () => { flow.set('id', 42); });
  test('2 a step with a bug', () => { expect(1, 'deliberate failure').toBe(2); });
  test('3 uses the record', () => { const id = flow.get('id'); needs(id, 'the record from "1 create"'); expect(id).toBe(42); });
  test('4 unrelated', () => { expect(true).toBe(true); });
  test('5 needs a record nobody made', () => { needs(flow.get('never'), 'the record from a step that failed'); });
});`,
    });
    // Before 2026-10-27 these files were serial: 3, 4 and 5 were all skipped after the failure in 2.
    expect(status(outcomes)).toEqual({
      '1 create': 'passed',
      '2 a step with a bug': 'failed',
      '3 uses the record': 'passed',
      '4 unrelated': 'passed',
      '5 needs a record nobody made': 'skipped',
    });
    expect(outcomes.find((o) => o.title.startsWith('5'))?.skipReason).toBe(
      'BLOCKED: needs the record from a step that failed, which did not complete in this run',
    );
  });

  test('a failed setup login skips only the tests that use that login', () => {
    const outcomes = runProject('login', {
      'pw.config.ts': `import { defineConfig } from '@playwright/test';
export default defineConfig({
  workers: 1, retries: 0, reporter: [['json']],
  projects: [
    { name: 'setup', testMatch: /login\\.setup\\.ts/ },
    { name: 'ui', testMatch: /uses\\.spec\\.ts/, dependencies: ['setup'] },
  ],
});`,
      'login.setup.ts': `import { test as setup } from '@fixtures';
import path from 'node:path';
import { saveLogin } from '../../tests/setup/session-reuse';
setup('log in the second account', async ({ page, log }) => {
  await saveLogin(page, path.join(__dirname, 'user2.json'), 'The second account', async () => {
    throw new Error('the login screen did not answer');
  }, log);
});`,
      'uses.spec.ts': `import { test, expect } from '@fixtures';
import path from 'node:path';
test.describe('needs the second account', () => {
  test.use({ storageState: path.join(__dirname, 'user2.json') });
  test('a two-account check', () => { expect(true).toBe(true); });
});
test('a check on its own session', () => { expect(true).toBe(true); });`,
    });
    // Before 2026-10-27 the failed login failed the setup project and Playwright skipped every test.
    expect(status(outcomes)).toEqual({
      'log in the second account': 'passed',
      'a two-account check': 'skipped',
      'a check on its own session': 'passed',
    });
    expect(outcomes.find((o) => o.title === 'a two-account check')?.skipReason).toBe(
      'BLOCKED: The second account login failed this run: the login screen did not answer',
    );
  });
});
