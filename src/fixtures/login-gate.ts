import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { test } from '@playwright/test';

/**
 * A saved login the setup project could not complete this run. The setup records it next to the
 * session file and passes, so the projects that depend on it still run; only the tests that need
 * that login skip, as BLOCKED with the reason (owner, 2026-10-27: only a real blocker may stop a test).
 */
const markerFor = (statePath: string): string => `${statePath}.blocked.txt`;

export function recordLoginBlocked(statePath: string, reason: string): void {
  writeFileSync(markerFor(statePath), reason);
}

export function clearLoginBlocked(statePath: string): void {
  rmSync(markerFor(statePath), { force: true });
}

export function loginBlockedReason(statePath: string): string | undefined {
  const marker = markerFor(statePath);
  return existsSync(marker) ? readFileSync(marker, 'utf8') : undefined;
}

/** The session file to open; when that login failed this run, the test is skipped as BLOCKED. */
export function signedIn(statePath: string): string {
  const reason = loginBlockedReason(statePath);
  test.skip(reason !== undefined, `BLOCKED: ${reason}`);
  return statePath;
}
