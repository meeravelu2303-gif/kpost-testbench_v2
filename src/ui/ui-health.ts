import type { ConsoleMessage, Page, Request, Response } from '@playwright/test';
import { env } from '@config/env';

/**
 * UI health monitor — the "deep on every screen" signal for the front end.
 *
 * A screen that *renders* can still be broken: it can throw an uncaught JavaScript exception, fail to
 * load its own scripts/styles/images, or console-error its way through a flow. Those are real UI
 * defects a render-only smoke test never sees. This attaches listeners to a page and collects them
 * while a test drives a screen, so any e2e test can assert the screen is not just present but *healthy*.
 *
 * Deliberate scoping to keep tickets trustworthy (no false-positive floods on the UI developer):
 *  - **pageErrors** — uncaught JS exceptions — are the strongest, lowest-noise UI-bug signal.
 *  - **brokenResources** — the app's own scripts/styles/images/fonts that failed to load — are
 *    front-end defects (a 404 asset, a broken bundle).
 *  - **failedApiCalls** (5xx / 4xx from the KPost API hosts) are collected but treated as CONTEXT,
 *    not a UI bug: the root cause is the backend, and the API suite already owns those. They are
 *    surfaced so a screen failure can point at the call behind it.
 *  - **consoleErrors** are collected for context only — they are too noisy (third-party warnings) to
 *    fail a run on their own.
 */

export interface FailedCall {
  url: string;
  status: number;
  method: string;
}

export interface UiHealthReport {
  /** Uncaught JS exceptions on the page — a front-end crash. */
  pageErrors: string[];
  /** The app's own static assets (js/css/img/font) that failed to load. */
  brokenResources: FailedCall[];
  /** KPost API calls the screen made that failed (backend cause; context, not a UI bug). */
  failedApiCalls: FailedCall[];
  /** console.error output — context only. */
  consoleErrors: string[];
}

/** Hosts that are the KPost application (front end + its APIs), vs third-party/analytics noise. */
function appHosts(): string[] {
  return [env.BASE_URL, env.KPOST_API_BASE_URL, env.KMAIL_API_BASE_URL, env.API_BASE_URL]
    .filter((u): u is string => Boolean(u))
    .map((u) => {
      try {
        return new URL(u).host;
      } catch {
        return '';
      }
    })
    .filter(Boolean);
}

const STATIC_ASSET = /\.(js|mjs|css|png|jpe?g|gif|svg|webp|woff2?|ttf|ico)(\?|$)/i;

/** True when a request targets one of the KPost application hosts (not a third party). */
function isAppRequest(url: string, hosts: readonly string[]): boolean {
  try {
    return hosts.includes(new URL(url).host);
  } catch {
    return false;
  }
}

/**
 * Start watching a page. Call the returned function to stop watching and get the report.
 *
 *   const stop = watchUiHealth(page);
 *   … drive the screen …
 *   const health = stop();
 *   expect(health.pageErrors, 'no JS crash on this screen').toEqual([]);
 */
export function watchUiHealth(page: Page): () => UiHealthReport {
  const hosts = appHosts();
  const report: UiHealthReport = {
    pageErrors: [],
    brokenResources: [],
    failedApiCalls: [],
    consoleErrors: [],
  };

  const onConsole = (msg: ConsoleMessage): void => {
    if (msg.type() === 'error') report.consoleErrors.push(msg.text().slice(0, 300));
  };
  const onPageError = (error: Error): void => {
    report.pageErrors.push(`${error.name}: ${error.message}`.slice(0, 500));
  };
  const onResponse = (response: Response): void => {
    const status = response.status();
    if (status < 400) return;
    const request: Request = response.request();
    const url = response.url();
    if (!isAppRequest(url, hosts)) return; // ignore third-party/analytics failures
    const call: FailedCall = { url: url.slice(0, 300), status, method: request.method() };
    if (STATIC_ASSET.test(url)) report.brokenResources.push(call);
    else report.failedApiCalls.push(call);
  };

  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  page.on('response', onResponse);

  return () => {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
    page.off('response', onResponse);
    return report;
  };
}

/** A one-line summary of the health issues that should FAIL a screen (crash + broken assets). */
export function healthFailures(report: UiHealthReport): string[] {
  return [
    ...report.pageErrors.map((e) => `JS error: ${e}`),
    ...report.brokenResources.map((r) => `broken resource ${r.status}: ${r.url}`),
  ];
}
