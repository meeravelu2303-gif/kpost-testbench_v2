import {
  isSqlClient,
  type DatabaseClient,
  type SqlDatabaseClient,
} from '@database/database-client';
import type { JsonObject } from '@utils/json';
import { suiteFor } from '@config/ownership.config';
import { expect, test, type Page } from '@playwright/test';

/**
 * Cross-layer (UI → API → DB) helpers: a screen action is judged at all three layers — what the screen
 * shows, the request it sent and the answer it got, and the row MySQL holds afterwards. The matrix of
 * which flow proves which module is `docs/reference/cross-layer-matrix.md`.
 */

/** The KPOST_QA SQL client, or a skip with the reason when the run has no database connection. */
export function requireKpostDb(databases: {
  for(suite: string): DatabaseClient;
}): SqlDatabaseClient {
  const db = databases.for('kpost-api');
  if (!isSqlClient(db)) {
    test.skip(true, 'needs the KPOST_QA database connection to judge the row');
    throw new Error('unreachable');
  }
  return db;
}

/** The first row of `sql`, polled until `ok(row)` holds (writes commit slightly after the response). */
export async function rowWhen<T extends JsonObject>(
  db: SqlDatabaseClient,
  sql: string,
  params: readonly unknown[],
  ok: (row: T | undefined) => boolean,
  message: string,
  timeout = 20_000,
): Promise<T | undefined> {
  let last: T | undefined;
  await expect
    .poll(
      async () => {
        last = (await db.query<T>(sql, params))[0];
        return ok(last);
      },
      { message, timeout },
    )
    .toBe(true);
  return last;
}

/**
 * POST to the KPost API with the PAGE's own session (its `accessToken`), the way the app itself calls.
 * Clean-ups and read-backs inside a UI test go through this, never through `endpoints` as the same
 * account: KPost keeps one session per account, so an API login would sign the browser out — and every
 * later test sharing that saved session with it.
 */
export async function postAsPage(
  page: Page,
  path: string,
  body: unknown,
): Promise<{ status: number; text: string }> {
  const url = `${suiteFor('kpost-api').baseUrl.replace(/\/$/, '')}${path}`;
  return page.evaluate(
    async ([u, b]) => {
      const r = await fetch(u, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('accessToken') ?? ''}`,
        },
        body: JSON.stringify(b),
      });
      return { status: r.status, text: await r.text() };
    },
    [url, body] as const,
  );
}

/**
 * A DATETIME column read back as epoch ms, taking its wall-clock value as UTC. KPOST stores UTC in
 * zone-less DATETIME columns; the driver reads them as the machine's local time, so the raw `Date`
 * is shifted by the local offset (IST: 5 h 30 m) and must not be compared directly with what the
 * screen sent.
 */
export function storedUtcMs(value: unknown): number | undefined {
  if (!(value instanceof Date)) return undefined;
  return Date.UTC(
    value.getFullYear(),
    value.getMonth(),
    value.getDate(),
    value.getHours(),
    value.getMinutes(),
    value.getSeconds(),
  );
}

/** A row as a short, readable string for an `observed` annotation (BLOBs decoded, long text cut). */
export function rowSummary(row: JsonObject | undefined, keys: readonly string[]): string {
  if (!row) return 'no row';
  return keys
    .map((k) => {
      const v: unknown = row[k];
      const s = Buffer.isBuffer(v)
        ? v.toString('utf8')
        : v instanceof Date
          ? v.toISOString()
          : String(v);
      return `${k}=${s.length > 60 ? `${s.slice(0, 60)}…` : s}`;
    })
    .join(', ');
}
