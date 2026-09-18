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

export interface BugzillaConfig {
  enabled: boolean;
  url: string;
  apiKey: string;
  dryRun: boolean;
  maxFile: number;
  fileUiFailures: boolean;
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
