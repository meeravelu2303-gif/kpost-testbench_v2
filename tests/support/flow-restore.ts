import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Principal } from '@config/auth.config';
import { env } from '@config/env';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { test } from '@fixtures';

/**
 * Helpers for a flow that changes a shared record and puts it back (CLAUDE.md §3, GLOBAL_LIFECYCLE).
 *
 * Incident 2026-11-05: the company-details flow saved a test PAN/GST, then the shared BUSINESS_M
 * session was ended mid-test, so its restore got 401 and the record kept the test values. The retry
 * then read those test values as "the original" and "restored" them. The two helpers below close both
 * halves: the first attempt's original is kept for every retry, and a restore refused for a lost
 * session logs in again once.
 */

const revive = (_key: string, value: unknown): unknown => {
  const v = value as { type?: unknown; data?: unknown } | null;
  return v && v.type === 'Buffer' && Array.isArray(v.data)
    ? Buffer.from(v.data as number[])
    : value;
};

/**
 * The record as it was before this test's FIRST attempt. Attempt 0 reads it and stores it in the
 * run's output folder; a retry gets that stored copy instead of reading a record the failed attempt
 * may have left changed. (Buffers survive the round trip.)
 */
export async function firstAttemptOriginal<T>(key: string, read: () => Promise<T>): Promise<T> {
  const info = test.info();
  const dir = path.join(info.project.outputDir, '.flow-originals', env.TEST_RUN_ID);
  const file = path.join(dir, `${key.replace(/[^A-Za-z0-9._-]+/g, '_')}.json`);
  if (info.retry > 0 && existsSync(file)) {
    info.annotations.push({
      type: 'original-from-first-attempt',
      description: `${key}: restored to the values read before attempt 1, not re-read`,
    });
    return JSON.parse(readFileSync(file, 'utf8'), revive) as T;
  }
  const value = await read();
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(value));
  return value;
}

/**
 * Sends a restore step; if KPost refused it as unauthenticated (the shared session was ended by
 * another login), logs `principal` in again and sends it once more.
 */
export async function restoreStep<R extends { status: number }>(
  endpoints: EndpointExecutor,
  principal: Principal,
  send: () => Promise<R>,
): Promise<R> {
  const first = await send();
  if (first.status !== 401) return first;
  endpoints.tokens.forget(principal);
  test.info().annotations.push({
    type: 'restore-relogin',
    description: `a restore step got 401 for "${principal.key}"; logged in again and re-sent it`,
  });
  return send();
}
