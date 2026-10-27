import type { Severity, ValidationCategory } from '@engine/validation-result';
import { env } from './env';

/**
 * How tickets are shaped and when filing may happen (where they go is in ownership.config.ts). The
 * summary `[<tag>]`, the whiteboard tags and the line-anchored description are read by other
 * systems.
 */

/**
 * Defect type, written as `[cat:Xxx]`; must be one of the tracker's own categories or it drops out
 * of every filter.
 */
export type BugCategory =
  'Functional' | 'Security' | 'Performance' | 'Compatibility' | 'Accessibility';

/** Who filed the bug, written as `[source:automation|manual]` (`manual` for `npm run bug:file`). */
export type BugSource = 'automation' | 'manual';

/**
 * Non-browser Playwright project names → the browser each really runs (the tracker knows only real
 * browsers).
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

/** Resolves the filing configuration; a missing URL or key means file nothing. */
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
