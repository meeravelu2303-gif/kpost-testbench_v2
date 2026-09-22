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
  /** The stack trace of each uncaught JS exception — which app code threw (the real evidence). */
  pageErrorStacks: string[];
  /** The app's own static assets (js/css/img/font) that failed to load. */
  brokenResources: FailedCall[];
  /** KPost API calls the screen made that failed (backend cause; context, not a UI bug). */
  failedApiCalls: FailedCall[];
  /** console.error output — context only. */
  consoleErrors: string[];
}

/** Hosts that are the KPost application (front end + its APIs), vs third-party/analytics noise. */
function appHosts(): string[] {
  return [
    env.BASE_URL,
    env.KPOST_API_BASE_URL,
    env.KMAIL_API_BASE_URL,
    env.API_BASE_URL,
    env.ADMIN_UI_BASE_URL,
    env.ADMIN_API_BASE_URL,
  ]
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
    pageErrorStacks: [],
    brokenResources: [],
    failedApiCalls: [],
    consoleErrors: [],
  };

  const onConsole = (msg: ConsoleMessage): void => {
    if (msg.type() === 'error') report.consoleErrors.push(msg.text().slice(0, 300));
  };
  const onPageError = (error: Error): void => {
    report.pageErrors.push(`${error.name}: ${error.message}`.slice(0, 500));
    // The stack is what tells a developer WHICH line of their code threw — essential for a JS crash,
    // which (unlike a broken layout) is invisible in a screenshot or video.
    report.pageErrorStacks.push((error.stack ?? '(no stack captured)').slice(0, 4000));
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

/**
 * Is the page's main JS thread responsive, or hung? A queued `page.evaluate` cannot run while the
 * renderer is blocked by a long task / infinite loop, so racing a trivial evaluate against a timeout
 * detects the "screen hangs" class directly: if the probe does not return within the budget, the UI
 * is frozen. Used after an interaction to catch a hang the static render checks never see.
 */
export async function isResponsive(page: Page, budgetMs = 8000): Promise<boolean> {
  const probe = page
    .evaluate(() => true)
    .then(() => true)
    .catch(() => true); // an evaluate error (navigation, closed) is not a hang
  const hung = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), budgetMs));
  return Promise.race([probe, hung]);
}

/** POST/PUT/PATCH/DELETE app-API calls that failed — the calls a USER ACTION triggers (a send, a
 * save). Unlike a background GET poll, a failed write on a deliberate action is the defect the user
 * feels ("I sent a message and nothing happened"), so it is a fileable signal, not just context. */
export function failedUserActions(report: UiHealthReport): FailedCall[] {
  return report.failedApiCalls.filter((c) => c.method !== 'GET' && c.method !== 'HEAD');
}

/**
 * A plain-English, developer- and reviewer-readable explanation of a screen crash — the evidence a
 * screenshot or video CANNOT give, because a JS exception happens silently in the browser console,
 * not on screen. It states, in simple words, what broke, the exact error, the stack trace (which app
 * code threw), and the API calls that failed during the same screen load — the almost-certain
 * trigger. Attached to the ticket so a human understands the defect without replaying a video.
 */
export function crashDiagnosis(screen: string, route: string, report: UiHealthReport): string {
  const line = '='.repeat(66);
  const errors = report.pageErrors.length ? report.pageErrors : ['(no JS error captured)'];
  const stacks = report.pageErrorStacks.length
    ? report.pageErrorStacks.join('\n\n---\n\n')
    : '(no stack captured)';
  const broken = report.brokenResources.map((r) => `  - ${r.status} ${r.method} ${r.url}`);
  const failedApi = report.failedApiCalls.map((r) => `  - ${r.status} ${r.method} ${r.url}`);

  // `null` marks a line to omit; '' is an intentional blank line kept for readability.
  const parts: (string | null)[] = [
    line,
    `KPOST FRONT-END CRASH — plain-English explanation`,
    `Screen: ${screen}   (route: ${route})`,
    line,
    '',
    'WHAT HAPPENED',
    `While the ${screen} screen was loading, the app's OWN JavaScript threw an`,
    `uncaught error and crashed that code path. In simple words: the code tried to`,
    `read a value from something that was empty (undefined), instead of checking`,
    `first that the value was there.`,
    '',
    'THE EXACT ERROR',
    ...errors.map((e) => `  ${e}`),
    '',
    "WHERE IT THREW — stack trace (the app's own code, top line = the crash)",
    stacks,
    '',
    'LIKELY TRIGGER — backend calls that FAILED during this same screen load',
    failedApi.length
      ? 'These API calls returned an error while the screen loaded. The crash is almost\n' +
        'certainly the front-end not guarding one of these empty/failed responses before\n' +
        'reading a field off it:'
      : '  (no failing API call captured this run — the empty value may come from a\n' +
        '   response shape the client did not expect rather than an HTTP error.)',
    ...failedApi,
    '',
    broken.length ? "BROKEN ASSETS (the screen's own files that failed to load)" : null,
    ...broken,
    broken.length ? '' : null,
    'WHY THIS IS A REAL DEFECT (and why a video does not show it)',
    'A normal user opening this screen hits this JavaScript crash. The page may LOOK',
    'partly rendered, so a screenshot or video shows a normal-looking screen — the',
    'error happens silently in the browser DevTools console, not on the page. This',
    'file IS the evidence: the error text and stack above are what a developer needs.',
    '',
    'HOW TO SEE IT YOURSELF',
    '  1. Sign in with a normal account.',
    `  2. Open the ${screen} screen (${route}).`,
    '  3. Open browser DevTools -> Console — the TypeError appears on load.',
    '',
    'TYPICAL FIX',
    'Guard the response before reading the field, e.g. use optional chaining',
    '(response?.data?.status) or handle the failing API call(s) above so the value',
    'passed to the client is never undefined.',
    line,
  ];
  return parts.filter((l): l is string => l !== null).join('\n');
}

/**
 * Renders the crash as something a human can SEE. A JS exception is invisible on the page — a normal
 * screenshot or video just shows a normal-looking screen. This injects a full-screen overlay onto the
 * live page that spells out, in large readable text, that the screen crashed, the exact error, where
 * it threw, and the API calls that failed behind it. The caller then screenshots it and holds it on
 * screen, so BOTH the image and the end of the recording show the defect a viewer can read and
 * understand — turning "static screen for a minute" into self-explanatory proof.
 */
export async function renderCrashOverlay(
  page: Page,
  screen: string,
  report: UiHealthReport,
): Promise<void> {
  const payload = {
    screen,
    errors: report.pageErrors.length ? report.pageErrors : ['(no JS error captured)'],
    stackTop: report.pageErrorStacks
      .map((s) =>
        s
          .split('\n')
          .slice(0, 3)
          .map((l) => l.trim())
          .join('\n'),
      )
      .join('\n\n'),
    api: report.failedApiCalls.map((c) => `${c.status}  ${c.method}  ${c.url}`),
    broken: report.brokenResources.map((c) => `${c.status}  ${c.url}`),
  };
  await page
    .evaluate((d) => {
      const esc = (s: string): string =>
        s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
      const old = document.getElementById('__kp_crash_overlay');
      if (old) old.remove();
      const el = document.createElement('div');
      el.id = '__kp_crash_overlay';
      el.setAttribute(
        'style',
        'position:fixed;inset:0;z-index:2147483647;background:rgba(8,10,22,.96);' +
          'color:#f4f4f5;font-family:Consolas,Menlo,monospace;font-size:15px;line-height:1.55;' +
          'padding:28px 32px;overflow:auto;',
      );
      const block = (color: string, label: string, body: string): string =>
        `<div style="margin-top:18px"><div style="color:${color};font-weight:700;` +
        `letter-spacing:.5px;font-size:13px;text-transform:uppercase;margin-bottom:6px">${label}</div>` +
        `<pre style="margin:0;background:#000;border-left:4px solid ${color};padding:12px 14px;` +
        `white-space:pre-wrap;word-break:break-all;border-radius:4px">${body}</pre></div>`;
      el.innerHTML =
        '<div style="max-width:960px;margin:0 auto">' +
        '<div style="font-size:26px;font-weight:800;color:#ff5c5c">' +
        '&#9888;&#65039; JAVASCRIPT CRASH ON THE ' +
        esc(d.screen.toUpperCase()) +
        ' SCREEN</div>' +
        '<div style="color:#ffe08a;margin-top:8px;font-size:15px">This screen looks normal but its ' +
        'own code threw an uncaught error while loading — the crash is invisible without this overlay. ' +
        'That is why the plain video shows no change.</div>' +
        block('#ff5c5c', 'The exact error', esc(d.errors.join('\n'))) +
        block('#ffd166', 'Where it threw (app code)', esc(d.stackTop) || '(no stack)') +
        block(
          '#7dd3fc',
          'API calls that failed behind it (the trigger)',
          d.api.length ? esc(d.api.join('\n')) : '(none captured)',
        ) +
        (d.broken.length ? block('#fca5a5', 'Broken assets', esc(d.broken.join('\n'))) : '') +
        '<div style="margin-top:20px;color:#a1a1aa;font-size:13px">Reproduce: open this screen and ' +
        'watch the browser DevTools Console — the error appears on load. Fix: guard the response ' +
        '(optional chaining) or handle the failing calls above so the value is never undefined.</div>' +
        '</div>';
      document.body.appendChild(el);
    }, payload)
    .catch(() => undefined);
}
