import { ROOT_DIR } from '@config/constants';
import { RUN_PROFILES, RUN_PROFILE_NAMES, type RunProfile } from '@config/run-profiles';
import { expect, test } from '@fixtures';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Executability guards (Phase 4I).
 *
 * A test that is never COLLECTED is worse than a failing one: it reports nothing, and a green run
 * is taken as coverage it never provided. These pin the two mechanisms this repository was losing
 * whole specs to — a tag filter and a project that no run mode names.
 *
 * They deliberately do not judge whether a test SHOULD run in a given mode; the `*_LIFECYCLE` gates
 * and the production guard own that, and nothing here relaxes either. They assert only that a
 * declared test is reachable by some supported command.
 */

/** Source with comments removed, so a guard matches CODE and never its own explanatory prose. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function walk(dir: string, match: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, match));
    else if (match(entry.name)) out.push(full);
  }
  return out;
}

const rel = (file: string): string => path.relative(ROOT_DIR, file).split(path.sep).join('/');

/** The suite tags the API commands filter on (`npm run kpost|kmail|admin`, and their profiles). */
const SUITE_TAGS = ['@kpost-api', '@kmail-api', '@admin-api'] as const;

// ---------------------------------------------------------------------------------------------
// 1. A hand-written API spec survives its suite's tag filter
// ---------------------------------------------------------------------------------------------

test.describe('executability: API suite tags @framework', () => {
  test('every hand-written api spec carries a suite tag on every top-level describe', () => {
    /*
     * Every API command filters by suite tag (`--grep @kpost-api`). That tag is applied
     * automatically to GENERATED cases by `tagsFor` in endpoint-cases.ts / contract-suite.ts, so a
     * generated case always survives the filter — but a hand-written spec only carries what its
     * author wrote. Twenty-eight of them carried none, so `npm run kpost` set nine
     * `*_LIFECYCLE=true` flags and then grep-removed every spec that reads them.
     *
     * The requirement is one suite tag, not a specific one: `state-calibration.spec.ts` lives in
     * the kpost tree and calibrates a KMail read, so its KMail block belongs to `@kmail-api`.
     */
    const specs = walk(path.join(ROOT_DIR, 'tests', 'api'), (n) => n.endsWith('.spec.ts')).filter(
      (file) => !/describeEndpoint(Cases|Contracts)\s*\(/.test(code(file)),
    );
    expect(specs.length, 'the hand-written api specs are still found').toBeGreaterThan(20);

    const untagged = specs.flatMap((file) =>
      [...code(file).matchAll(/^test\.describe\((?:(?!\n\n)[\s\S])*?\{$/gm)]
        .map((match) => match[0].replace(/\s+/g, ' '))
        .filter((statement) => !SUITE_TAGS.some((tag) => statement.includes(tag)))
        .map((statement) => `${rel(file)} :: ${statement.slice(0, 90)}`),
    );
    expect(untagged, 'a spec with no suite tag is dropped by every API command').toEqual([]);
  });

  test('the generated cases still supply the suite tag automatically', () => {
    // The hand-written tags above are only needed BECAUSE the generators add theirs here; if this
    // ever stops being true, the rule for hand-written specs changes too.
    for (const file of ['endpoint-cases.ts', 'contract-suite.ts']) {
      const src = code(path.join(ROOT_DIR, 'src', 'validation-engine', file));
      expect(src, `${file} tags each case with its suite`).toMatch(/`@\$\{endpoint\.suite\.id\}`/);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// 2. No Playwright project is defined but unreachable
// ---------------------------------------------------------------------------------------------

test.describe('executability: run modes reach every project @framework', () => {
  test('every project in playwright.config.ts is named by at least one run profile', () => {
    /*
     * `integration` was defined, held a real cross-endpoint test, and was named by no npm script and
     * no profile — so it executed in no run mode at all. A project nothing can select is a test
     * suite nobody runs.
     */
    const config = code(path.join(ROOT_DIR, 'playwright.config.ts'));
    const declared = new Set(
      [...config.matchAll(/name: '([a-z-]+)'/g)].map((match) => match[1] as string),
    );
    for (const call of config.matchAll(/browserProject\('([a-z]+)'/g)) declared.add(call[1] ?? '');
    expect(declared.size, 'the project list was parsed').toBeGreaterThan(5);

    const reachable = new Set(
      RUN_PROFILE_NAMES.flatMap((name) => (RUN_PROFILES[name] as RunProfile).projects),
    );
    const orphaned = [...declared].filter((project) => !reachable.has(project)).sort();
    expect(orphaned, 'a project no profile names can never be run through `npm run bench`').toEqual(
      [],
    );
  });

  test('every project a profile names actually exists', () => {
    const config = code(path.join(ROOT_DIR, 'playwright.config.ts'));
    const missing = RUN_PROFILE_NAMES.flatMap((name) =>
      (RUN_PROFILES[name] as RunProfile).projects
        .filter((project) => !config.includes(`'${project}'`))
        .map((project) => `${name} → ${project}`),
    );
    expect(missing, 'a profile naming an unknown project fails the run at startup').toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// 3. The mock-fixture integration flow is gated on the mock, not hidden by the destructive filter
// ---------------------------------------------------------------------------------------------

test.describe('executability: the integration flow @framework', () => {
  test('it is gated on the mock server, and never on the destructive filter', () => {
    /*
     * Its four endpoints are all `mockFixture: true`, which `EndpointExecutor.send` routes to the
     * mock's base URL whatever the suite or TEST_ENV — so it cannot reach a live deployment and
     * `@destructive` (which exists to keep mutation away from one) only made it invisible: the
     * production `grepInvert` removed it from every run. What it genuinely needs is the mock
     * SERVER, which Playwright starts only for `MOCK_API=true`.
     */
    const spec = code(path.join(ROOT_DIR, 'tests', 'integration', 'user-lifecycle.spec.ts'));
    expect(spec, 'the destructive filter must not hide a mock-only flow').not.toContain(
      '@destructive',
    );
    expect(spec, 'it states the real prerequisite instead').toContain('test.skip(!env.MOCK_API');
  });
});

// ---------------------------------------------------------------------------------------------
// 4. The "everything" command actually names every surface
// ---------------------------------------------------------------------------------------------

test.describe('executability: the full-regression command @framework', () => {
  test('`all` runs every API surface plus the UI, and `all:file` matches it', () => {
    /*
     * `all` is documented as "Everything" and ran `kpost kmail ui` — the Admin API, a first-class
     * surface with its own Bugzilla product and its own owner, was simply absent. A command that
     * claims to be complete and is not is worse than a narrower one honestly named.
     *
     * It composes the EXISTING per-surface commands; there is no second Admin runner and no extra
     * flag, so `all` grants exactly the live-write permission `npm run admin` already had.
     */
    const scripts = (
      JSON.parse(readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8')) as {
        scripts: Record<string, string>;
      }
    ).scripts;

    const surfaces = ['kpost', 'kmail', 'admin', 'ui'];
    const all = (scripts.all ?? '').split(/\s+/);
    expect(all[0], '`all` composes the per-surface commands through the suite runner').toBe('node');
    expect(
      all.slice(2),
      'every surface, and the UI last so its session is established last',
    ).toEqual(surfaces);
    expect(
      (scripts['all:file'] ?? '').split(/\s+/).slice(2),
      '`all:file` covers exactly the same surfaces',
    ).toEqual(surfaces.map((surface) => `${surface}:file`));

    // Each named surface must be a real command; `all` must never invent one.
    for (const surface of surfaces) {
      expect(scripts[surface], `npm run ${surface} exists`).toBeTruthy();
      expect(scripts[`${surface}:file`], `npm run ${surface}:file exists`).toBeTruthy();
    }
  });
});
