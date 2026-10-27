import type { Page } from '@playwright/test';
import type { Severity } from '@engine/validation-result';
import type { ScreenDef } from './screens';
import type { UiHealthReport } from './ui-health';
import { noteDiagnostic } from './failure-diagnostics';

/**
 * The UI check catalogue, the front-end analogue of the API validators: each check runs on every
 * screen in `screens.ts`. Findings are collected, never thrown, so one run surfaces every issue.
 */

export interface UiFinding {
  /** Which check produced it, e.g. `accessibility`. */
  check: string;
  severity: Severity;
  /** Plain, application-level description of the problem. */
  message: string;
}

export interface UiCheckContext {
  page: Page;
  screen: ScreenDef;
  /** Collected by the health monitor while the screen loaded. */
  health: UiHealthReport;
  /** Milliseconds from navigation to the screen being ready. */
  loadMs: number;
}

export interface UiCheck {
  name: string;
  run: (ctx: UiCheckContext) => Promise<UiFinding[]> | UiFinding[];
}

/** The screen must load without a front-end crash or a broken asset it depends on. */
export const healthCheck: UiCheck = {
  name: 'ui.health',
  run: ({ health }) => {
    const findings: UiFinding[] = [];
    for (const error of health.pageErrors) {
      findings.push({
        check: 'ui.health',
        severity: 'HIGH',
        message: `Uncaught JS error: ${error}`,
      });
    }
    if (health.brokenResources.length > 0) {
      const sample = health.brokenResources
        .slice(0, 3)
        .map((r) => `${r.status} ${r.url}`)
        .join('; ');
      findings.push({
        check: 'ui.health',
        severity: 'MEDIUM',
        message: `${health.brokenResources.length} front-end asset(s) failed to load: ${sample}`,
      });
    }
    return findings;
  },
};

/** The screen should render within a time budget. */
export const performanceCheck: UiCheck = {
  name: 'ui.performance',
  run: ({ loadMs }) => {
    // Generous enough not to fire on a normal heavy live load.
    const BUDGET_MS = 10_000;
    if (loadMs > BUDGET_MS) {
      return [
        {
          check: 'ui.performance',
          severity: 'MEDIUM',
          message: `The screen took ${loadMs}ms to render (budget ${BUDGET_MS}ms).`,
        },
      ];
    }
    return [];
  },
};

/**
 * Finds where horizontal overflow comes from: the deepest element whose content is wider than its
 * box (where the CSS fix belongs), and elements reaching past the right edge. A plain string so no
 * build tool rewrites it.
 */
export const OVERFLOW_PROBE = `(() => {
  const vw = document.documentElement.clientWidth;
  const label = function (el) {
    const parts = []; let n = el;
    for (let i = 0; n && i < 4; i++) {
      let p = n.tagName.toLowerCase();
      if (n.id) { parts.unshift(p + '#' + n.id); break; }
      const c = (n.getAttribute('class') || '').trim().split(/[ \\t\\n]+/).filter(Boolean).slice(0, 4);
      if (c.length) p += '.' + c.join('.');
      parts.unshift(p); n = n.parentElement;
    }
    return parts.join(' > ');
  };
  const sizing = function (s) {
    return 'width:' + s.width + '; min-width:' + s.minWidth + '; flex:' + s.flex + '; white-space:' + s.whiteSpace + '; margin:' + s.margin + '; padding:' + s.padding;
  };
  const all = Array.from(document.body.querySelectorAll('*'));
  const contentOverflow = all.filter(function (el) {
    const s = getComputedStyle(el);
    return el.scrollWidth > el.clientWidth + 0.5 && el.clientWidth > 0 && s.overflowX === 'visible' && el.getBoundingClientRect().right > vw - 40;
  });
  const deepest = contentOverflow.filter(function (el) { return !contentOverflow.some(function (o) { return o !== el && el.contains(o); }); });
  const inner = deepest.slice(0, 3).map(function (el) {
    const s = getComputedStyle(el);
    const kids = Array.from(el.children).map(function (k) {
      const ks = getComputedStyle(k); const r = k.getBoundingClientRect();
      return { sel: label(k).split(' > ').pop(), w: Math.round(r.width), shrink: ks.flexShrink, minw: ks.minWidth, ws: ks.whiteSpace };
    }).sort(function (a, b) { return b.w - a.w; }).slice(0, 6);
    return { sel: label(el), content: el.scrollWidth, box: el.clientWidth, css: sizing(s), kids: kids };
  });
  const edge = all.filter(function (el) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || r.right <= vw + 0.5) return false;
    const p = el.parentElement;
    return !(p && p !== document.body && p.getBoundingClientRect().right > vw + 0.5);
  }).slice(0, 4).map(function (el) {
    const r = el.getBoundingClientRect();
    return { sel: label(el), left: Math.round(r.left), right: Math.round(r.right), css: sizing(getComputedStyle(el)) };
  });
  return { vw: vw, page: document.documentElement.scrollWidth, inner: inner, edge: edge };
})()`;

async function overflowCulprits(page: Page): Promise<string> {
  const found = (await page.evaluate(OVERFLOW_PROBE).catch(() => undefined)) as
    | {
        vw: number;
        page: number;
        inner: {
          sel: string;
          content: number;
          box: number;
          css: string;
          kids: { sel: string; w: number; shrink: string; minw: string; ws: string }[];
        }[];
        edge: { sel: string; left: number; right: number; css: string }[];
      }
    | undefined;
  if (!found) return '(the page could not be measured)';
  const lines = [
    `Screen ${found.vw}px, page ${found.page}px — ${found.page - found.vw}px too wide.`,
  ];
  if (found.inner.length) {
    lines.push('Element(s) whose CONTENT is wider than their own box — fix the CSS here:');
    found.inner.forEach((e, i) => {
      lines.push(
        `${i + 1}. ${e.sel}`,
        `   content ${e.content}px in a ${e.box}px box (${e.content - e.box}px too wide)`,
        `   computed: ${e.css}`,
      );
      lines.push(
        '   its children, widest first (flex-shrink 0 or a min-width stops them from shrinking):',
      );
      for (const k of e.kids)
        lines.push(
          `     - ${k.sel}: ${k.w}px (flex-shrink ${k.shrink}, min-width ${k.minw}, white-space ${k.ws})`,
        );
    });
  }
  if (found.edge.length) {
    lines.push('Element(s) whose box reaches past the right edge of the screen:');
    found.edge.forEach((e, i) =>
      lines.push(`${i + 1}. ${e.sel}: ${e.left}px → ${e.right}px`, `   computed: ${e.css}`),
    );
  }
  if (!found.inner.length && !found.edge.length)
    lines.push(
      '(no single element found — the extra width may come from a pseudo-element or a transform)',
    );
  return lines.join('\n');
}

/** No horizontal overflow at the supported desktop widths (KPost is desktop-only). */
export const responsiveCheck: UiCheck = {
  name: 'ui.layout',
  run: async ({ page }) => {
    const original = page.viewportSize();
    const findings: UiFinding[] = [];
    try {
      for (const width of [1280, 1440] as const) {
        await page.setViewportSize({ width, height: 900 });
        const overflow = await page.evaluate(() => {
          const doc = document.documentElement;
          return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
        });
        // 1px for sub-pixel rounding only; clientWidth already excludes the scrollbar.
        if (overflow.scrollWidth > overflow.clientWidth + 1) {
          findings.push({
            check: 'ui.layout',
            severity: 'MEDIUM',
            message: `Horizontal overflow at ${width}px (a supported desktop width): content is ${overflow.scrollWidth}px wide, the viewport ${overflow.clientWidth}px — the user must scroll sideways.`,
          });
          // Which element sticks out, for the diagnosis (the message above is the fingerprint).
          noteDiagnostic(
            page,
            `Elements wider than the screen at ${width}px`,
            await overflowCulprits(page),
          );
        }
      }
      return findings;
    } finally {
      if (original) await page.setViewportSize(original);
    }
  },
};

/** Basic accessibility: alt text, form labels, and the document's lang + title. */
export const accessibilityCheck: UiCheck = {
  name: 'ui.accessibility',
  run: async ({ page }) => {
    const a11y = await page.evaluate(() => {
      const imagesMissingAlt = Array.from(document.querySelectorAll('img')).filter(
        (img) => !img.hasAttribute('alt') && img.getAttribute('aria-hidden') !== 'true',
      ).length;
      const fieldsMissingLabel = Array.from(
        document.querySelectorAll(
          'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]), textarea, select',
        ),
      ).filter((el) => {
        const id = el.getAttribute('id');
        const labelled = id && document.querySelector(`label[for="${CSS.escape(id)}"]`);
        const aria =
          el.getAttribute('aria-label') ||
          el.getAttribute('aria-labelledby') ||
          el.getAttribute('placeholder') ||
          el.getAttribute('title');
        const wrapped = el.closest('label');
        return !labelled && !aria && !wrapped;
      }).length;
      return {
        imagesMissingAlt,
        fieldsMissingLabel,
        lang: document.documentElement.getAttribute('lang') ?? '',
        title: document.title ?? '',
      };
    });

    const findings: UiFinding[] = [];
    if (!a11y.lang) {
      findings.push({
        check: 'ui.accessibility',
        severity: 'MEDIUM',
        message:
          'The page has no <html lang> attribute — screen readers cannot detect the language.',
      });
    }
    if (!a11y.title.trim()) {
      findings.push({
        check: 'ui.accessibility',
        severity: 'MEDIUM',
        message: 'The page has no document <title>.',
      });
    }
    if (a11y.fieldsMissingLabel > 0) {
      // LOW (context, not filed): an unlabelled field is often a usable framework-internal input.
      findings.push({
        check: 'ui.accessibility',
        severity: 'LOW',
        message: `${a11y.fieldsMissingLabel} form field(s) have no <label> or accessible name.`,
      });
    }
    if (a11y.imagesMissingAlt > 0) {
      // LOW (below the filing floor): pervasive and lower-impact.
      findings.push({
        check: 'ui.accessibility',
        severity: 'LOW',
        message: `${a11y.imagesMissingAlt} image(s) have no alt text.`,
      });
    }
    return findings;
  },
};

/**
 * Rendered error text: a visible text node that is entirely `undefined`, `null`, `NaN`, `[object
 * Object]` or `Invalid Date` (never the token inside a sentence, to keep false positives at zero).
 */
export const contentErrorCheck: UiCheck = {
  name: 'ui.content',
  run: async ({ page }) => {
    const hits = await page.evaluate(() => {
      const BAD = new Set(['undefined', 'null', 'NaN', '[object Object]', 'Invalid Date']);
      const found: string[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const text = (node.nodeValue ?? '').trim();
        if (!BAD.has(text)) continue;
        const el = node.parentElement;
        // Only visible text counts — a hidden template node is not a user-facing bug.
        if (!el || el.offsetParent === null) continue;
        const tag = el.tagName.toLowerCase();
        if (tag === 'script' || tag === 'style') continue;
        found.push(
          `"${text}" in <${tag}${el.className ? ` class="${String(el.className)}"` : ''}>`,
        );
        if (found.length >= 8) break;
      }
      return found;
    });
    return hits.map((h) => ({
      check: 'ui.content',
      severity: 'HIGH',
      message: `A value failed to render and shows as raw text: ${h} — a user sees this literally.`,
    }));
  },
};

/** Broken images: an `<img>` with a real `src` that loaded with `naturalWidth === 0`. */
export const imageCheck: UiCheck = {
  name: 'ui.images',
  run: async ({ page }) => {
    const broken = await page.evaluate(() =>
      Array.from(document.querySelectorAll('img'))
        .filter((img) => {
          const src = img.getAttribute('src') ?? '';
          if (!src || src.startsWith('data:')) return false;
          return img.complete && img.naturalWidth === 0;
        })
        .slice(0, 6)
        .map((img) => img.getAttribute('src') ?? ''),
    );
    if (broken.length === 0) return [];
    return [
      {
        check: 'ui.images',
        severity: 'MEDIUM',
        message: `${broken.length} image(s) failed to load: ${broken.join('; ')}`,
      },
    ];
  },
};

/** Mixed content: a plain-HTTP resource on an HTTPS page. */
export const mixedContentCheck: UiCheck = {
  name: 'ui.security',
  run: async ({ page }) => {
    if (!page.url().startsWith('https://')) return [];
    const insecure = await page.evaluate(() => {
      const urls = new Set<string>();
      for (const el of Array.from(document.querySelectorAll('[src], [href]'))) {
        const raw = el.getAttribute('src') || el.getAttribute('href') || '';
        if (/^http:\/\//i.test(raw)) urls.add(raw);
      }
      return Array.from(urls).slice(0, 6);
    });
    if (insecure.length === 0) return [];
    return [
      {
        check: 'ui.security',
        severity: 'HIGH',
        message: `Mixed content — ${insecure.length} insecure http:// resource(s) on an https page: ${insecure.join('; ')}`,
      },
    ];
  },
};

/** Console errors the page logged; LOW (below the filing floor) because the class is noisy. */
export const consoleCheck: UiCheck = {
  name: 'ui.console',
  run: ({ health }) => {
    if (health.consoleErrors.length === 0) return [];
    const sample = health.consoleErrors.slice(0, 3).join(' | ');
    return [
      {
        check: 'ui.console',
        severity: 'LOW',
        message: `${health.consoleErrors.length} console error(s) on this screen: ${sample}`,
      },
    ];
  },
};

/** Duplicate DOM ids; LOW because a React portal can legitimately repeat one. */
export const domCheck: UiCheck = {
  name: 'ui.dom',
  run: async ({ page }) => {
    const dupes = await page.evaluate(() => {
      const counts = new Map<string, number>();
      for (const el of Array.from(document.querySelectorAll('[id]'))) {
        const id = el.id;
        if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      return Array.from(counts.entries())
        .filter(([, n]) => n > 1)
        .slice(0, 6)
        .map(([id, n]) => `#${id} ×${n}`);
    });
    if (dupes.length === 0) return [];
    return [
      {
        check: 'ui.dom',
        severity: 'LOW',
        message: `Duplicate element id(s): ${dupes.join(', ')} — breaks label/anchor association.`,
      },
    ];
  },
};

export const UI_CHECKS: readonly UiCheck[] = [
  healthCheck,
  performanceCheck,
  responsiveCheck,
  accessibilityCheck,
  contentErrorCheck,
  imageCheck,
  mixedContentCheck,
  consoleCheck,
  domCheck,
];

/** Run every UI check against one loaded screen and collect all findings. */
export async function runUiChecks(ctx: UiCheckContext): Promise<UiFinding[]> {
  const findings: UiFinding[] = [];
  for (const check of UI_CHECKS) {
    findings.push(...(await check.run(ctx)));
  }
  return findings;
}
