import type { Severity, ValidationCategory } from '@engine/validation-result';
import { env } from './env';

/**
 * How this bench files defects into Bugzilla.
 *
 * Conventions here are a contract with two other systems and must not drift:
 * - `[<tag>]` in the summary is how a re-run finds its own ticket instead of duplicating it.
 * - `[cat:Xxx]` on the status whiteboard is parsed by the BUGZILLA-UI backend; `[browser:a,b]`
 *   is read by the same UI for browser-specific defects.
 * - The description is line-anchored (`Classification:`, `Expected:`, `Actual:`, `curl:`, ...)
 *   so the Bug Tracker UI renders a structured report instead of a raw dump.
 *
 * Assignment is never set: each component's default assignee owns its tickets, and the server
 * mints the `KPA-###` alias itself — a client-chosen alias can only collide with it.
 */

/** Defect type axis, written as `[cat:Xxx]`. Bugzilla has no native field for it. */
export type BugCategory = 'Functional' | 'Security' | 'Performance' | 'Compatibility';

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

/**
 * Endpoint tag → Bugzilla component in the API product. Endpoint definitions carry the tags,
 * so routing a new API area is one line here. Unknown tags fall back to the product's
 * catch-all component, which is validated against the live product before anything is filed.
 */
export const API_COMPONENT_BY_TAG: Record<string, string> = {
  auth: 'Authentication V2',
  users: 'User Profile V2',
  companies: 'Company Administration',
  dictionary: 'Common Reference Data & Utilities V2',
  platform: 'kpost-webservice-application',
};

/** Spec-path fragment → component in the UI product, for browser test failures. */
export const UI_COMPONENT_BY_PATH: Record<string, string> = {
  auth: 'Auth',
  login: 'Auth',
  home: 'Home',
  settings: 'Settings',
  kmail: 'KMail',
  katchup: 'Katchup',
};

export interface BugzillaConfig {
  enabled: boolean;
  url: string;
  apiKey: string;
  dryRun: boolean;
  apiProduct: string;
  uiProduct: string;
  version: string;
  apiFallbackComponent: string;
  uiFallbackComponent: string;
  maxFile: number;
  fileUiFailures: boolean;
  /** Prefix of the dedupe tag written into every summary: `[KPV2-XXXXXX]`. */
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
    apiProduct: env.BUGZILLA_PRODUCT,
    uiProduct: env.BUGZILLA_UI_PRODUCT,
    version: env.BUGZILLA_VERSION,
    apiFallbackComponent: env.BUGZILLA_FALLBACK_COMPONENT,
    uiFallbackComponent: env.BUGZILLA_UI_FALLBACK_COMPONENT,
    maxFile: env.BUGZILLA_MAX_FILE,
    fileUiFailures: env.BUGZILLA_FILE_UI_FAILURES,
    tagPrefix: 'KPV2',
    timeoutMs: 20_000,
  };
}

/** Resolutions that mean a human judged this NOT a defect. Never re-file one of these. */
export const JUDGED_NOT_A_DEFECT = new Set(['INVALID', 'WONTFIX', 'WORKSFORME', 'DUPLICATE']);

/** Bugzilla limits: summary column and comment/description body. */
export const BUGZILLA_LIMITS = { summary: 255, comment: 65_535, snippet: 20_000 } as const;
