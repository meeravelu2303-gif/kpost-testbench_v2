import type { Page } from '@playwright/test';
import type { Severity } from '@engine/validation-result';
import type { ScreenDef } from './screens';
import type { UiHealthReport } from './ui-health';

/**
 * The centralized UI check catalogue — the front-end analogue of the API validators. Each check is
 * written ONCE and runs on EVERY screen the deep suite drives, so a screen only declares what it is
 * (route + controls, in `screens.ts`) and inherits every check automatically. Adding a check here
 * makes it apply to all screens, exactly like adding an API validator.
 *
 * Categories, mirroring the API engine's dimensions but for a rendered page:
 *   health         — uncaught JS exceptions and broken front-end assets (from the health monitor)
 *   performance     — the screen renders within a time budget
 *   layout          — no horizontal overflow at the SUPPORTED desktop widths (KPost is desktop-only)
 *   accessibility   — images have alt text, form fields have labels, the page declares lang + title
 *
 * A finding is one problem on one screen. Findings are collected (never thrown) so one run surfaces
 * every issue, and the spec turns them into soft assertions — the same "a case per check" shape the
 * API side uses.
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
    // A live SPA over the public internet; a screen slower than this to become interactive is a real
    // UX problem, but the budget is generous enough not to fire on a normal heavy live load.
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
 * The layout must not overflow horizontally at the widths the app SUPPORTS. KPost is a desktop app
 * (its nav rail and side columns are `d-none d-xl-*` — hidden below ~1200px), so it is not designed
 * for phone widths and testing those would just report a size it never targets. So this checks the
 * supported desktop widths only; overflow there is a real broken-layout bug.
 */
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
        // Tolerance for sub-pixel rounding / a scrollbar.
        if (overflow.scrollWidth > overflow.clientWidth + 16) {
          findings.push({
            check: 'ui.layout',
            severity: 'MEDIUM',
            message: `Horizontal overflow at ${width}px (a supported desktop width): content is ${overflow.scrollWidth}px wide, the viewport ${overflow.clientWidth}px — the user must scroll sideways.`,
          });
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
      // LOW, so it informs without filing: on a React SPA a field without a formal <label> is often
      // a framework-internal input (e.g. a react-select) that is still usable, so this is too fuzzy
      // to file as a bug. Reported as context; raise BUGZILLA_MIN_SEVERITY to file it.
      findings.push({
        check: 'ui.accessibility',
        severity: 'LOW',
        message: `${a11y.fieldsMissingLabel} form field(s) have no <label> or accessible name.`,
      });
    }
    if (a11y.imagesMissingAlt > 0) {
      // Pervasive and lower-impact — reported at LOW (below the default filing floor) so it informs
      // without flooding the queue; raise BUGZILLA_MIN_SEVERITY to file it.
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
 * **Rendered error text** — the highest-signal UI bug there is: a screen that literally shows
 * `undefined`, `null`, `NaN`, `[object Object]` or `Invalid Date` because a value failed to format.
 * To keep false positives at zero (the API side's calibration bar), it flags only text nodes whose
 * ENTIRE trimmed content is one of those tokens (a field rendered as the raw value), not the token
 * appearing inside a larger sentence.
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

/**
 * **Broken images** — an `<img>` with a real `src` that failed to load (`complete` but
 * `naturalWidth === 0`). A missing avatar / icon / attachment thumbnail is a visible defect.
 */
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

/**
 * **Mixed content** — on an HTTPS page, a resource requested over plain HTTP. Browsers block or warn,
 * so the asset is often missing, and it is a security downgrade. Zero false positives on an https app.
 */
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

/**
 * **App console errors** — errors the page logged to the console (React warnings, PropType failures,
 * unhandled rejections the app swallowed). Reported at LOW (context, below the filing floor) because
 * the class is noisier than a hard crash; raise `BUGZILLA_MIN_SEVERITY` to file it.
 */
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

/**
 * **Duplicate DOM ids** — two elements sharing an `id` breaks `label[for]`, `getElementById` and
 * anchor navigation. LOW (context) because a React app can legitimately repeat an id across a portal;
 * it informs without flooding the queue.
 */
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
