import type { Severity, ValidationCategory } from '@engine/validation-result';
import { env } from './env';

/**
 * How this bench files defects into Bugzilla.
 *
 * **Where a ticket goes** (product, component, assignee) is not decided here — that is
 * ownership, and it lives in one place: `src/config/ownership.config.ts`. This file only
 * covers how a ticket is shaped and when filing may happen.
 *
 * Conventions that are a contract with other systems and must not drift:
 * - `[<tag>]` in the summary is how a re-run finds its own ticket instead of duplicating it.
 * - `[cat:Xxx]` on the status whiteboard is parsed by the BUGZILLA-UI backend; `[browser:a,b]`
 *   is read by the same UI for browser-specific defects.
 * - The description is line-anchored (`Classification:`, `Expected:`, `Actual:`, ...) so the Bug
 *   Tracker UI renders a structured report instead of a raw dump.
 */

/**
 * Defect type axis, written as `[cat:Xxx]`. Bugzilla has no native field for it. The values are the
 * BUGZILLA-UI tracker's own list (`backend/src/lib/classification.ts` CATEGORIES, minus its
 * `Unclassified` fallback): a value outside it shows as Unclassified there AND drops out of every
 * category filter, including Unclassified's.
 */
export type BugCategory =
  'Functional' | 'Security' | 'Performance' | 'Compatibility' | 'Accessibility';

/**
 * Who filed the bug, written as `[source:automation|manual]`. The tracker's Source filter, its
 * "UI/API Automation" vs "Manual UI/API test" badge and the export's Test Type read only this tag in
 * lists (`sourceOf`, BUGZILLA-UI classification.ts). The bench's own findings are `automation`; a bug
 * a person writes by hand through the bench (`npm run bug:file`) is `manual`, like one filed in the UI.
 */
export type BugSource = 'automation' | 'manual';

/**
 * Playwright project names that are not browser names, and the browser each one really runs. The
 * tracker's `[browser:]` list is `chromium | firefox | webkit | mobile-chrome`; anything else shows as
 * an unknown browser. Re-verification maps it back (`projectForBrowser`), because it matches the tag
 * against the project that ran the test.
 */
const PROJECT_BROWSER: Readonly<Record<string, string>> = { 'admin-ui': 'chromium' };
/** The product whose UI bugs are re-checked by a non-browser-named project. */
const PRODUCT_PROJECT: Readonly<Record<string, string>> = { 'KPost Admin UI': 'admin-ui' };

/** The `[browser:]` value for a Playwright project. */
export function browserForProject(project: string): string {
  return PROJECT_BROWSER[project] ?? project;
}

/** The Playwright project that re-checks a `[browser:]` value on a given product. */
export function projectForBrowser(product: string | undefined, browser: string): string {
  const project = product ? PRODUCT_PROJECT[product] : undefined;
  return project && PROJECT_BROWSER[project] === browser ? project : browser;
}

/** Our severity bands onto Bugzilla's. `blocker` and `enhancement` are deliberately unused. */
export const BUGZILLA_SEVERITY: Record<Severity, string> = {
  CRITICAL: 'critical',
  HIGH: 'major',
  MEDIUM: 'minor',
  LOW: 'trivial',
  INFO: 'trivial',
};

export const BUGZILLA_PRIORITY: Record<Severity, string> = {
  CRITICAL: 'Highest',
  HIGH: 'High',
  MEDIUM: 'Normal',
  LOW: 'Low',
  INFO: 'Lowest',
};

const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
  INFO: 0,
};

export function meetsSeverityFloor(severity: Severity): boolean {
  return SEVERITY_RANK[severity] >= SEVERITY_RANK[env.BUGZILLA_MIN_SEVERITY];
}

/** Validator category → the `[cat:Xxx]` axis. */
export function categoryFor(category: ValidationCategory): BugCategory {
  switch (category) {
    case 'SECURITY':
    case 'AUTHENTICATION':
    case 'AUTHORIZATION':
      return 'Security';
    case 'PERFORMANCE':
      return 'Performance';
    default:
      return 'Functional';
  }
}

export interface BugzillaConfig {
  enabled: boolean;
  url: string;
  apiKey: string;
  dryRun: boolean;
  maxFile: number;
  fileUiFailures: boolean;
  /** File WCAG (accessibility) findings, one ticket per rule (see env BUGZILLA_FILE_ACCESSIBILITY). */
  fileAccessibilityFailures: boolean;
  /** Auto-close a bench-filed bug this run verified as fixed (see env `BUGZILLA_AUTO_RESOLVE`). */
  autoResolve: boolean;
  /** Close verified-fixed bugs but file/comment no new ones (see env `BUGZILLA_RESOLVE_ONLY`). */
  resolveOnly: boolean;
  /** Prefix of the dedupe tag written into every summary: `[KP-XXXXXX]`. */
  tagPrefix: string;
  timeoutMs: number;
}

/**
 * Resolves the filing configuration. Missing URL or key is a decision, not a fault: the
 * reporter then says so in one line and files nothing.
 */
export function readBugzillaConfig(): BugzillaConfig {
  return {
    enabled: Boolean(env.BUGZILLA_URL && env.BUGZILLA_API_KEY),
    url: (env.BUGZILLA_URL ?? '').replace(/\/+$/, ''),
    apiKey: env.BUGZILLA_API_KEY ?? '',
    dryRun: env.BUGZILLA_DRY_RUN,
    maxFile: env.BUGZILLA_MAX_FILE,
    fileUiFailures: env.BUGZILLA_FILE_UI_FAILURES,
    fileAccessibilityFailures: env.BUGZILLA_FILE_ACCESSIBILITY,
    autoResolve: env.BUGZILLA_AUTO_RESOLVE,
    resolveOnly: env.BUGZILLA_RESOLVE_ONLY,
    tagPrefix: 'KP',
    timeoutMs: 20_000,
  };
}

/** Resolutions that mean a human judged this NOT a defect. Never re-file one of these. */
export const JUDGED_NOT_A_DEFECT = new Set(['INVALID', 'WONTFIX', 'WORKSFORME', 'DUPLICATE']);

/** Bugzilla limits: summary column and comment/description body. */
export const BUGZILLA_LIMITS = { summary: 255, comment: 65_535, snippet: 20_000 } as const;
