import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@fixtures';

/**
 * `.env.example` is what a fresh checkout starts from. It drifted for a month because every new
 * account or flag went straight into `.env`; a second machine set up from the template could not
 * run. This guard makes the template a contract: every key the code reads must be named in it (a
 * commented `# KEY=` line counts — it documents a flag the commands set), and on a machine that has
 * a real `.env`, every key in that file must be named too.
 */
const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

/** Keys the runner or CI injects; a person never sets them in `.env`. */
const RUNNER_PROVIDED = new Set(['CI', 'GITHUB_RUN_NUMBER', 'TEST_RUN_ID']);

function templateKeys(): Set<string> {
  // `KEY=` at the start of a line, optionally commented out (`# KEY=` or `# KEY=   OTHER=`).
  const keys = new Set<string>();
  for (const line of read('.env.example').split(/\r?\n/)) {
    const body = line.replace(/^#\s*/, '');
    for (const m of body.matchAll(/(?:^|\s)([A-Z][A-Z0-9_]+)=/g)) keys.add(m[1]!);
  }
  return keys;
}

function schemaKeys(): string[] {
  // The zod schema in src/config/env.ts: two-space-indented `KEY: z.…` members.
  return [...read('src/config/env.ts').matchAll(/^ {2}([A-Z][A-Z0-9_]+): z\./gm)]
    .map((m) => m[1]!)
    .filter((k) => !RUNNER_PROVIDED.has(k));
}

function testDataKeys(): string[] {
  // The SOURCES map in src/config/test-data.config.ts: field -> 'QA_…' variable name.
  return [...read('src/config/test-data.config.ts').matchAll(/'(QA_[A-Z0-9_]+)'/g)].map(
    (m) => m[1]!,
  );
}

const QATEST_KEYS = [1, 2, 3, 4, 5, 6]
  .map((n) => `QATEST${n}_KPOST_ID`)
  .concat('QATEST_SHARED_PASSWORD');

test.describe('.env.example names every key the bench reads @framework', () => {
  test('every env.ts schema key is documented', () => {
    const template = templateKeys();
    const missing = schemaKeys().filter((k) => !template.has(k));
    expect(missing, 'add each key to .env.example (a commented `# KEY=` line is enough)').toEqual(
      [],
    );
  });

  test('every QA_* test-data key and the qatest account keys are documented', () => {
    const template = templateKeys();
    const missing = [...new Set([...testDataKeys(), ...QATEST_KEYS])].filter(
      (k) => !template.has(k),
    );
    expect(missing, 'add each key to .env.example').toEqual([]);
  });

  test('on a configured machine, every key in the real .env is documented', () => {
    const envPath = path.join(ROOT, '.env');
    test.skip(!existsSync(envPath), 'no local .env on this machine (fresh checkout / CI)');
    const template = templateKeys();
    const real = [...readFileSync(envPath, 'utf8').matchAll(/^([A-Z][A-Z0-9_]+)=/gm)].map(
      (m) => m[1]!,
    );
    const missing = real.filter((k) => !template.has(k));
    expect(
      missing,
      'a key was added to .env without documenting it in .env.example — the next checkout would miss it',
    ).toEqual([]);
  });
});
