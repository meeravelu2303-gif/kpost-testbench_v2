import { BUGZILLA_LIMITS, BUGZILLA_PRIORITY, BUGZILLA_SEVERITY } from '@config/bugzilla.config';
import { normalizeForFingerprint } from './bug-fingerprint';
import type { BugCandidate } from './bug-candidate';

/**
 * Turns a candidate into the exact ticket shape this Bugzilla expects.
 *
 * The description is **line-anchored** (`Classification:` / `Category:` / `Representative
 * endpoint:` / `Module:` / `Expected:` / `Actual:` / `Repro:` / `Owner:` / `Environment:` /
 * `Run date:`). The BUGZILLA-UI front end parses exactly these anchors to render a structured
 * report, so each label is one space after the colon, with no padding and no underline.
 *
 * `assigned_to` is never set: the component's default assignee owns the ticket, and the server
 * mints the `KPA-###` alias itself.
 */

export interface BugFields {
  product: string;
  component: string;
  summary: string;
  version: string;
  description: string;
  severity: string;
  priority: string;
  op_sys: string;
  platform: string;
  /** `[cat:Xxx]` (+ `[browser:…]`). The create parameter is `status_whiteboard`. */
  status_whiteboard: string;
  /** The module's developer. Omitted when the account cannot be verified, so the
      component's default assignee takes the ticket rather than the create failing. */
  assigned_to?: string;
}

function clamp(value: string, label: string): string {
  if (value.length <= BUGZILLA_LIMITS.snippet) return value;
  return `${value.slice(0, BUGZILLA_LIMITS.snippet)}\n… [${label} truncated — ${value.length} characters total; the full text is in the attached evidence file]`;
}

/** `[KPV2-A1B2C3] title`, trimmed to Bugzilla's 255-character summary column, tag intact. */
export function buildSummary(candidate: BugCandidate): string {
  const tag = `[${candidate.id}]`;
  const title = candidate.title.replace(/\s+/g, ' ').trim();
  const full = `${tag} ${title}`;
  if (full.length <= BUGZILLA_LIMITS.summary) return full;
  return `${tag} ${title.slice(0, BUGZILLA_LIMITS.summary - tag.length - 2).trimEnd()}…`;
}

/** The phrase used to spot an existing ticket for the same fault filed without our tag. */
export function summaryPhrase(candidate: BugCandidate): string {
  const PHRASE_CHARS = 60;
  return candidate.title
    .replace(/^\[[^\]]+]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PHRASE_CHARS);
}

/** Compares two summaries ignoring tags and run-specific values. */
export function sameFault(a: string, b: string): boolean {
  const strip = (value: string): string =>
    normalizeForFingerprint(value.replace(/\[[A-Z0-9-]+]/g, '').toLowerCase());
  return strip(a) === strip(b);
}

export function buildWhiteboard(candidate: BugCandidate): string {
  const tags = [`[cat:${candidate.category}]`];
  if (candidate.browsers?.length) tags.push(`[browser:${candidate.browsers.join(',')}]`);
  return tags.join('');
}

export function buildDescription(candidate: BugCandidate): string {
  const endpointLabel = candidate.source === 'api' ? 'Representative endpoint:' : 'Endpoint:';
  const lines = [
    `Classification: ${candidate.classification}`,
    `Category: ${candidate.category}`,
    `${endpointLabel} ${candidate.endpoint ?? '(not applicable)'}`,
    `Module: ${candidate.component}`,
    '',
    candidate.narrative,
  ];
  if (candidate.occurrences > 1) {
    lines.push('', `Observed ${candidate.occurrences} times in this run.`);
  }
  if (candidate.affectedEndpoints && candidate.affectedEndpoints.length > 1) {
    // A single platform-wide fault: name every endpoint it was seen on, so triage can confirm the
    // one shared fix covers them all rather than hunting for the scope.
    lines.push(
      '',
      `Affects ${candidate.affectedEndpoints.length} endpoints — one shared fix resolves all of them:`,
      ...candidate.affectedEndpoints.map((endpoint) => `  - ${endpoint}`),
    );
  }
  if (candidate.browsers?.length) {
    lines.push('', `Browsers affected: ${candidate.browsers.join(', ')}.`);
  }
  if (candidate.correlationId) {
    lines.push(
      '',
      `Correlation ID (search the application logs for it): ${candidate.correlationId}`,
    );
  }
  lines.push(
    '',
    'Expected:',
    clamp(candidate.expected, 'expected'),
    '',
    'Actual:',
    clamp(candidate.actual, 'response'),
  );
  if (candidate.responseBody) {
    lines.push(
      '',
      `Response body (HTTP ${candidate.responseStatus ?? '?'}):`,
      clamp(candidate.responseBody, 'response body'),
    );
  }
  if (candidate.repro) lines.push('', 'Repro:', clamp(candidate.repro, 'repro'));
  /*
   * The curl goes last of the reproduction material, matching the tickets already in this Bugzilla
   * (see bug 98). Any token is a $KPOST_TOKEN placeholder and masked values stay masked - see
   * src/bug-tracker/curl.ts for why that is deliberate.
   */
  if (candidate.curl) lines.push('', 'curl:', clamp(candidate.curl, 'curl'));
  lines.push(
    '',
    `Owner: ${candidate.ownerName} <${candidate.assignee}> — maintainer of the ${candidate.product} module`,
    `Environment: ${candidate.environment} (${candidate.baseURL})`,
    `Run date: ${candidate.observedAt}`,
    `Filed by: kpost-testbench_v2, build ${candidate.build}, run ${candidate.testRunId}`,
  );

  const description = lines.join('\n');
  if (description.length <= BUGZILLA_LIMITS.comment) return description;
  const notice = '\n… [truncated to fit Bugzilla’s comment limit; full evidence is attached]';
  return `${description.slice(0, BUGZILLA_LIMITS.comment - notice.length)}${notice}`;
}

export function buildBugFields(
  candidate: BugCandidate,
  target: { version: string; assignee?: string },
): BugFields {
  return {
    product: candidate.product,
    component: candidate.component,
    summary: buildSummary(candidate),
    version: target.version,
    description: buildDescription(candidate),
    severity: BUGZILLA_SEVERITY[candidate.severity],
    priority: BUGZILLA_PRIORITY[candidate.severity],
    op_sys: 'All',
    platform: 'All',
    status_whiteboard: buildWhiteboard(candidate),
    // Omitted when the account could not be verified, so the component's default owner takes it.
    ...(target.assignee ? { assigned_to: target.assignee } : {}),
  };
}

/** The unabridged evidence, attached so the description can stay readable. */
export function buildEvidenceAttachment(candidate: BugCandidate): string {
  return [
    `Defect: ${candidate.id}`,
    `Classification: ${candidate.classification}`,
    `Endpoint: ${candidate.endpoint ?? '(not applicable)'}`,
    `Environment: ${candidate.environment} (${candidate.baseURL})`,
    `Run: ${candidate.testRunId} (build ${candidate.build})`,
    candidate.correlationId ? `Correlation ID: ${candidate.correlationId}` : '',
    '',
    'Expected:',
    candidate.expected,
    '',
    'Actual:',
    candidate.actual,
    '',
    'Evidence:',
    JSON.stringify(candidate.evidence, null, 2),
  ]
    .filter((line) => line !== '')
    .join('\n');
}

export function buildReproducedComment(candidate: BugCandidate): string {
  return (
    `Reproduced by kpost-testbench_v2 on ${candidate.observedAt} ` +
    `(${candidate.environment}, build ${candidate.build}, run ${candidate.testRunId}).\n` +
    `Check: ${candidate.classification}. Observed ${candidate.occurrences} time(s) this run.` +
    (candidate.correlationId ? `\nCorrelation ID: ${candidate.correlationId}` : '')
  ).slice(0, BUGZILLA_LIMITS.comment);
}

export function buildReopenComment(candidate: BugCandidate, resolution: string): string {
  return (
    `Reopening: this defect was observed again by kpost-testbench_v2 on ${candidate.observedAt} ` +
    `(${candidate.environment}, build ${candidate.build}), after the ticket was resolved ${resolution}. ` +
    `Tracked here rather than under a new ticket number.\n` +
    `Check: ${candidate.classification}.` +
    (candidate.correlationId ? `\nCorrelation ID: ${candidate.correlationId}` : '')
  ).slice(0, BUGZILLA_LIMITS.comment);
}

export function buildAdoptionComment(candidate: BugCandidate): string {
  return (
    `kpost-testbench_v2 observed this same fault on ${candidate.observedAt} ` +
    `(${candidate.environment}, build ${candidate.build}).\n` +
    `Tagged [${candidate.id}] so future automated runs update this ticket instead of filing a duplicate.\n` +
    `Check: ${candidate.classification}.`
  ).slice(0, BUGZILLA_LIMITS.comment);
}
