import { writeFileSync } from 'node:fs';
import type { Page, TestInfo } from '@playwright/test';

/**
 * Records, for every browser test, what a developer needs to fix a failure — and writes it as a
 * plain-text "failure diagnosis" attached to the test ONLY when it fails.
 *
 * Built from the UI developers' review of 118 bugs (2026-10-08): they asked again and again for the
 * exception stack, the exact steps (each click, or the Tab path element by element), the console
 * errors, each failing request with the element that made it, and — for layout bugs — the element
 * that sticks out. Before this, only the Profile/Settings/Contacts breakage sweeps wrote any of it.
 *
 * Never changes a test's assertion message: that message is the bug's fingerprint, and changing it
 * would re-file every existing bug as a duplicate. Everything new goes in the attachment.
 */

export const FAILURE_DIAGNOSIS_ATTACHMENT = 'failure-diagnosis';

/** Raw events kept per test; requests are grouped when written, so this is generous on purpose. */
const MAX = 400;

/** Extra sections a check adds for the current page (e.g. the layout check's overflowing elements). */
const notes = new WeakMap<Page, { title: string; text: string }[]>();

export function noteDiagnostic(page: Page, title: string, text: string): void {
  const list = notes.get(page) ?? [];
  list.push({ title, text });
  notes.set(page, list);
}

/*
 * Runs in every document of the page. Keeps, in sessionStorage so it survives navigations within the
 * tab: (1) the last steps taken — clicks, focus changes (the Tab path), focus-moving keys, form
 * changes, offline/online; (2) every image / media / stylesheet that failed to load, with the element
 * that asked for it, recorded at the moment it failed (that element may be gone by failure time).
 */
const PAGE_RECORDER = `(() => {
  if (window.__qaRecorder) return; window.__qaRecorder = true;
  const read = (k) => { try { return JSON.parse(sessionStorage.getItem(k) || '[]'); } catch (e) { return []; } };
  const write = (k, v, n) => { try { sessionStorage.setItem(k, JSON.stringify(v.slice(-n))); } catch (e) {} };
  const describe = (el) => {
    if (!el || el.nodeType !== 1) return String((el && el.nodeName) || el);
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const cls = (el.getAttribute('class') || '').trim().split(/\\s+/).filter(Boolean).slice(0, 3);
    if (cls.length) s += '.' + cls.join('.');
    for (const a of ['role', 'aria-label', 'name', 'type', 'placeholder', 'href', 'alt']) {
      const v = el.getAttribute(a); if (v) s += '[' + a + '="' + v.slice(0, 40) + '"]';
    }
    const t = (el.innerText || el.value || '').trim().replace(/\\s+/g, ' ').slice(0, 40);
    return t ? s + ' "' + t + '"' : s;
  };
  const path = (el) => {
    const parts = []; let n = el;
    for (let i = 0; n && n.nodeType === 1 && i < 5; i++) {
      let p = n.tagName.toLowerCase();
      if (n.id) { parts.unshift(p + '#' + n.id); break; }
      const c = (n.getAttribute('class') || '').trim().split(/\\s+/).filter(Boolean)[0];
      if (c) p += '.' + c;
      parts.unshift(p); n = n.parentElement;
    }
    return parts.join(' > ');
  };
  const step = (kind, el) => {
    const s = read('__qaSteps');
    s.push({ t: new Date().toISOString().slice(11, 23), k: kind, p: el ? path(el) : '', d: el ? describe(el) : '', u: location.pathname });
    write('__qaSteps', s, 40);
  };
  addEventListener('click', (e) => step('click', e.target), true);
  addEventListener('focusin', (e) => step('focus', e.target), true);
  addEventListener('keydown', (e) => {
    if (['Tab', 'Enter', 'Escape', ' ', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key))
      step('key ' + (e.shiftKey && e.key === 'Tab' ? 'Shift+Tab' : e.key === ' ' ? 'Space' : e.key), e.target);
  }, true);
  addEventListener('change', (e) => step('change', e.target), true);
  addEventListener('submit', (e) => step('submit', e.target), true);
  addEventListener('offline', () => step('network went OFFLINE', null));
  addEventListener('online', () => step('network came back ONLINE', null));
  addEventListener('error', (e) => {
    const t = e.target;
    if (!t || t === window || !t.tagName) return;
    const src = t.currentSrc || t.src || t.href || '';
    if (!src) return;
    const f = read('__qaFailedAssets');
    f.push({ src: src, by: path(t) + '  —  ' + describe(t), u: location.pathname });
    write('__qaFailedAssets', f, 200);
  }, true);
})();`;

interface Recorded {
  errors: { at: string; text: string }[];
  console: { at: string; text: string }[];
  requests: { at: string; method: string; url: string; outcome: string; type: string }[];
  navigations: { at: string; url: string }[];
}

type Step = { t: string; k: string; p: string; d: string; u: string };
type FailedAsset = { src: string; by: string; u: string };

const now = (): string => new Date().toISOString().slice(11, 23);
const cap = <T>(list: T[], item: T): void => {
  list.push(item);
  if (list.length > MAX) list.shift();
};
const ESC = String.fromCharCode(27);
const stripAnsi = (text: string): string => text.split(ESC).map((part, i) => (i ? part.replace(/^\[[0-9;]*m/, '') : part)).join('');

/** Starts recording on a fresh page. Call before the test navigates. */
export async function startRecording(page: Page): Promise<Recorded> {
  const rec: Recorded = { errors: [], console: [], requests: [], navigations: [] };
  await page.addInitScript(PAGE_RECORDER);
  page.on('pageerror', (err) => cap(rec.errors, { at: now(), text: err.stack || `${err.name}: ${err.message}` }));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const loc = msg.location();
    cap(rec.console, { at: now(), text: `${msg.text()}${loc.url ? `  (${loc.url}:${loc.lineNumber})` : ''}` });
  });
  page.on('requestfailed', (req) =>
    cap(rec.requests, {
      at: now(),
      method: req.method(),
      url: req.url(),
      outcome: `failed: ${req.failure()?.errorText ?? 'unknown'}`,
      type: req.resourceType(),
    }),
  );
  page.on('response', (res) => {
    if (res.status() < 400) return;
    const req = res.request();
    cap(rec.requests, { at: now(), method: req.method(), url: res.url(), outcome: `HTTP ${res.status()}`, type: req.resourceType() });
  });
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) cap(rec.navigations, { at: now(), url: frame.url() });
  });
  return rec;
}

/** A page call that can never hang the teardown — a frozen page is exactly the case we must still report. */
async function within<T>(ms: number, work: Promise<T>): Promise<T | undefined> {
  return Promise.race([work.catch(() => undefined), new Promise<undefined>((r) => setTimeout(() => r(undefined), ms))]);
}

async function readSession<T>(page: Page, key: string): Promise<T[]> {
  if (page.isClosed()) return [];
  const value = await within(
    3000,
    page.evaluate((k) => {
      try {
        return JSON.parse(sessionStorage.getItem(k) || '[]') as unknown;
      } catch {
        return [];
      }
    }, key),
  );
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * The same endpoint failing the same way many times (e.g. one image per contact) becomes ONE line with
 * a count and one example — otherwise 40 identical lines bury the one request that matters.
 */
function groupRequests(requests: Recorded['requests'], assets: FailedAsset[]): string[] {
  const initiatorOf = (url: string): string | undefined => {
    const base = url.split('?')[0];
    return assets.find((a) => a.src === url || a.src.split('?')[0] === base)?.by;
  };
  const groups = new Map<string, { n: number; first: string; last: string; example: string; by?: string }>();
  for (const r of requests) {
    let where = r.url;
    try {
      const u = new URL(r.url);
      where = u.origin + u.pathname;
    } catch {
      /* keep the raw URL */
    }
    const shape = where
      .split('/')
      .map((seg) => (/%40|@/.test(seg) ? '{id}' : /^[0-9a-f-]{8,}$/i.test(seg) ? '{id}' : /^\d+$/.test(seg) ? '{n}' : seg))
      .join('/');
    const key = `${r.method} ${shape} → ${r.outcome} (${r.type})`;
    const g = groups.get(key);
    if (g) {
      g.n += 1;
      g.last = r.at;
      g.by ??= initiatorOf(r.url);
    } else {
      groups.set(key, { n: 1, first: r.at, last: r.at, example: r.url, by: initiatorOf(r.url) });
    }
  }
  return [...groups.entries()].map(([key, g]) => {
    const when = g.n > 1 ? `${g.n}× between ${g.first} and ${g.last}` : `at ${g.first}`;
    return `- ${key}  — ${when}\n    example: ${g.example}${g.by ? `\n    requested by: ${g.by}` : ''}`;
  });
}

/** Writes and attaches the diagnosis — only for a failed test. */
export async function writeDiagnosisIfFailed(page: Page, rec: Recorded, testInfo: TestInfo): Promise<void> {
  if (testInfo.status === testInfo.expectedStatus) return;

  const alive = !page.isClosed();
  const steps = await readSession<Step>(page, '__qaSteps');
  const assets = await readSession<FailedAsset>(page, '__qaFailedAssets');
  const vp = page.viewportSize();

  const lines: string[] = [
    'FAILURE DIAGNOSIS',
    `Test: ${testInfo.titlePath.slice(1).join(' > ')}`,
    `Browser: ${testInfo.project.name}   Viewport: ${vp ? `${vp.width}x${vp.height}` : 'unknown'}   Recorded: ${new Date().toISOString()}`,
    `Page at the time of failure: ${alive ? page.url() : '(page already closed)'}`,
    '',
    'WHAT FAILED',
    ...testInfo.errors.map((e) => stripAnsi(e.message ?? '').split('\n').slice(0, 4).join('\n')),
    '',
    `JAVASCRIPT ERRORS IN THE PAGE (${rec.errors.length}) — full stack, oldest first`,
    ...(rec.errors.length ? rec.errors.map((e, i) => `${i + 1}. [${e.at}] ${e.text}`) : ['(none)']),
    '',
    `STEPS BEFORE THE FAILURE (last ${Math.min(steps.length, 25)}, oldest first) — clicks, Tab/focus path, keys`,
    ...(steps.length
      ? steps.slice(-25).map((s, i) => `${String(i + 1).padStart(2)}. [${s.t}] ${s.k.padEnd(14)} ${s.p}${s.d ? `  —  ${s.d}` : ''}  (${s.u})`)
      : ['(no clicks or key presses in this test — it only loaded and measured the screen)']),
    '',
    `CONSOLE ERRORS (${rec.console.length})`,
    ...(rec.console.length ? rec.console.slice(-30).map((c) => `- [${c.at}] ${c.text}`) : ['(none)']),
    '',
    `FAILED OR ERROR REQUESTS (${rec.requests.length}, grouped by endpoint and result)`,
    ...(rec.requests.length ? groupRequests(rec.requests, assets) : ['(none)']),
    '',
    'PAGES VISITED',
    ...(rec.navigations.length ? rec.navigations.map((n) => `- [${n.at}] ${n.url}`) : ['(none)']),
  ];
  for (const note of notes.get(page) ?? []) lines.push('', note.title.toUpperCase(), note.text);

  const file = testInfo.outputPath('failure-diagnosis.txt');
  writeFileSync(file, `${lines.join('\n')}\n`);
  await testInfo.attach(FAILURE_DIAGNOSIS_ATTACHMENT, { path: file, contentType: 'text/plain' });
}
