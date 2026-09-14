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
 *   responsive      — no horizontal overflow at a phone width (the layout does not break)
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
    const BUDGET_MS = 6_000;
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

/** The layout must not overflow horizontally at a phone width. */
export const responsiveCheck: UiCheck = {
  name: 'ui.responsive',
  run: async ({ page }) => {
    const original = page.viewportSize();
    try {
      await page.setViewportSize({ width: 390, height: 844 });
      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
      });
      // A few pixels of tolerance for sub-pixel rounding / scrollbars.
      if (overflow.scrollWidth > overflow.clientWidth + 4) {
        return [
          {
            check: 'ui.responsive',
            severity: 'MEDIUM',
            message: `Horizontal overflow at phone width (390px): content is ${overflow.scrollWidth}px wide, the screen is ${overflow.clientWidth}px — the user must scroll sideways.`,
          },
        ];
      }
      return [];
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
      findings.push({
        check: 'ui.accessibility',
        severity: 'MEDIUM',
        message: `${a11y.fieldsMissingLabel} form field(s) have no label or accessible name.`,
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

export const UI_CHECKS: readonly UiCheck[] = [
  healthCheck,
  performanceCheck,
  responsiveCheck,
  accessibilityCheck,
];

/** Run every UI check against one loaded screen and collect all findings. */
export async function runUiChecks(ctx: UiCheckContext): Promise<UiFinding[]> {
  const findings: UiFinding[] = [];
  for (const check of UI_CHECKS) {
    findings.push(...(await check.run(ctx)));
  }
  return findings;
}
