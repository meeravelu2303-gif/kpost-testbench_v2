import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { env } from '@config/env';
import { test } from '@fixtures';

/**
 * What one test of an ordered flow hands to the next (a created id, an original setting), kept on
 * disk for this run. Playwright starts a fresh worker after a failed test, so a module `let` would be
 * lost and every later test would look blocked. With this, a later test that does not need the failed
 * one still runs, and one that does is skipped by `needs()` as BLOCKED, with the reason.
 */
export function flowState<T extends Record<string, unknown>>(name: string) {
  const file = path.join('test-results', 'flow-state', env.TEST_RUN_ID, `${name}.json`);
  const read = (): Partial<T> => {
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as Partial<T>;
    } catch {
      return {};
    }
  };
  return {
    get: <K extends keyof T>(key: K): T[K] | undefined => read()[key],
    set: <K extends keyof T>(key: K, value: T[K]): void => {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify({ ...read(), [key]: value }));
    },
  };
}

/**
 * Skips this test when an earlier step did not produce what it needs: the only acceptable reason a
 * test does not run (owner, 2026-10-27), so it says which step blocked it.
 */
export function needs(value: unknown, step: string): void {
  test.skip(
    value === undefined || value === null,
    `BLOCKED: needs ${step}, which did not complete in this run`,
  );
}
