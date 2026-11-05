import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '@config/constants';
import {
  FRAMEWORK_AREAS,
  TEST_INFRA_DIRS,
  TEST_PRODUCTS,
  type TestProduct,
} from '@config/test-layout';
import { expect, test } from '@fixtures';

/**
 * The folder layout is `tests/<product>/<type>/[<module>/]<file>` (src/config/test-layout.ts). A file in
 * the wrong place fails here, so the tree stays readable and tests/README.md stays true.
 */
const TESTS = path.join(ROOT_DIR, 'tests');

function filesUnder(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name.endsWith('-snapshots') ? [] : filesUnder(full);
    return [path.relative(TESTS, full).split(path.sep).join('/')];
  });
}

/** UI spec names end in their kind (`-e2e`, `-api-handling`, …); the kind is the type folder. */
const UI_KIND_FOLDERS = new Set([
  'e2e',
  'functional',
  'screens',
  'validation',
  'api-handling',
  'security',
  'accessibility',
  'resilience',
  'responsive',
  'visual',
  'performance',
]);

function misplaced(product: TestProduct): string[] {
  const problems: string[] = [];
  const types = new Map(product.types.map((t) => [t.dir, t]));
  for (const file of filesUnder(path.join(TESTS, product.dir))) {
    const parts = file.split('/').slice(1);
    const name = parts[parts.length - 1] as string;
    if (parts.length === 1) {
      problems.push(`${file}: a file directly in the product folder (put it in a type folder)`);
      continue;
    }
    const type = types.get(parts[0] as string);
    if (!type) {
      problems.push(`${file}: "${parts[0]}" is not a test type of ${product.dir}`);
      continue;
    }
    if (type.kind === 'support') {
      if (product.testFile.test(name)) problems.push(`${file}: a test inside support/`);
      continue;
    }
    if (!product.testFile.test(name)) {
      problems.push(`${file}: not a test file (helpers go in support/)`);
      continue;
    }
    const depth = type.byModule ? 3 : 2;
    if (parts.length !== depth)
      problems.push(
        `${file}: expected ${type.byModule ? `${type.dir}/<module>/<file>` : `${type.dir}/<file>`}`,
      );
    if (
      product.runner === 'playwright-ui' &&
      UI_KIND_FOLDERS.has(type.dir) &&
      !name.endsWith(`-${type.dir}.spec.ts`)
    )
      problems.push(`${file}: a ${type.dir}/ spec is named <module>-<area>-${type.dir}.spec.ts`);
    if (product.dir === 'kpost-api' && type.byModule && type.kind !== 'excluded') {
      const moduleDir = parts[1] as string;
      if (moduleDir !== 'platform' && !name.startsWith(`${moduleDir}-`))
        problems.push(`${file}: a ${moduleDir}/ spec is named ${moduleDir}-<what>.spec.ts`);
    }
  }
  return problems;
}

test.describe('the test folder layout @framework', () => {
  test('tests/ holds only the products, framework, setup, support and README.md', () => {
    const allowed = new Set([...TEST_PRODUCTS, ...TEST_INFRA_DIRS].map((d) => d.dir));
    const entries = fs.readdirSync(TESTS, { withFileTypes: true });
    const stray = entries
      .filter((e) => (e.isDirectory() ? !allowed.has(e.name) : e.name !== 'README.md'))
      .map((e) => e.name);
    expect(stray, 'unknown entries in tests/').toEqual([]);
    for (const product of TEST_PRODUCTS)
      expect(fs.existsSync(path.join(TESTS, product.dir)), product.dir).toBe(true);
  });

  for (const product of TEST_PRODUCTS) {
    test(`${product.dir}: every file is in <type>/[<module>/] and named for it`, () => {
      expect(misplaced(product)).toEqual([]);
    });
  }

  test('framework self-tests are grouped by area', () => {
    const areas = new Set(FRAMEWORK_AREAS.map((a) => a.dir));
    const stray = filesUnder(path.join(TESTS, 'framework')).filter(
      (file) => !areas.has(file.split('/')[1] as string),
    );
    expect(stray, 'framework files outside an area folder').toEqual([]);
  });

  test('tests/README.md lists the current folders and file counts (npm run tests:inventory)', () => {
    const readme = fs.readFileSync(path.join(TESTS, 'README.md'), 'utf8');
    const block = /<!-- inventory-files: (\{.*\}) -->/.exec(readme);
    expect(block, 'tests/README.md is written by npm run tests:inventory').toBeTruthy();
    const recorded = JSON.parse(block?.[1] ?? '{}') as Record<string, number>;
    const actual: Record<string, number> = {};
    for (const product of TEST_PRODUCTS)
      for (const file of filesUnder(path.join(TESTS, product.dir))) {
        const [dir, type] = file.split('/');
        const name = file.split('/').pop() as string;
        if (!product.testFile.test(name)) continue;
        const key = `${dir}/${type}`;
        actual[key] = (actual[key] ?? 0) + 1;
      }
    expect(recorded, 'run npm run tests:inventory after adding or moving a test file').toEqual(
      actual,
    );
  });
});
