import {
  BUGZILLA_LIMITS,
  BUGZILLA_PRIORITY,
  BUGZILLA_SEVERITY,
  browserForProject,
} from '@config/bugzilla.config';
import { normalizeForFingerprint } from './bug-fingerprint';
import type { BugCandidate } from './bug-candidate';
import { developerGuidance } from './guidance';

/**
 * Turns a candidate into the ticket shape this Bugzilla expects. The description is line-anchored
 * (`Classification:`, `Expected:`, `Actual:`, `curl:` …) because the BUGZILLA-UI tracker parses
 * those labels.
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
  /**
   * The module's developer; omitted when unverifiable, so the component default assignee takes it.
   */
  assigned_to?: string;
}

function clamp(value: string, label: string): string {
  if (value.length <= BUGZILLA_LIMITS.snippet) return value;
  return `${value.slice(0, BUGZILLA_LIMITS.snippet)}\n… [${label} truncated — ${value.length} characters total; the full text is in the attached evidence file]`;
}

/** `[KP-A1B2C3] title`, trimmed to Bugzilla's 255-character summary column, tag intact. */
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
  if (candidate.browsers?.length) {
    // Real browser names only; `admin-ui` is written as the browser it runs.
    const browsers = [...new Set(candidate.browsers.map(browserForProject))].sort();
    tags.push(`[browser:${browsers.join(',')}]`);
  }
  // The tracker's Source filter reads this tag.
  tags.push(`[source:${candidate.filedBy ?? 'automation'}]`);
  return tags.join('');
}

/** Wraps prose to 78 columns: Bugzilla shows comments in a non-wrapping <pre>. Not for curl/SQL. */
function wrap(text: string, width = 78): string[] {
  const out: string[] = [];
  for (const paragraph of String(text).split('\n')) {
    if (!paragraph.trim()) {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of paragraph.trim().split(/\s+/)) {
      if (line && (line + ' ' + word).length > width) {
        out.push(line);
        line = word;
      } else {
        line = line ? line + ' ' + word : word;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

/** A one-line "state of the system before this failed" summary. */
function buildPreconditions(candidate: BugCandidate): string {
  if (candidate.source === 'ui') {
    const where = candidate.browsers?.length ? `in ${candidate.browsers.join('/')}, ` : '';
    return `Signed in with a valid test account, ${where}on the ${candidate.component} screen.`;
  }
  return 'A valid, authenticated test account calling the endpoint below with a live session token.';
}

/**
 * The ticket body. Labels and their order match every existing [KP-*] ticket, so all read alike.
 * Plain text only: this Bugzilla 5.2 ignores Markdown.
 */
export function buildDescription(candidate: BugCandidate): string {
  const endpointLabel = candidate.source === 'api' ? 'Representative endpoint:' : 'Endpoint:';
  const lines = [
    `Classification: ${candidate.classification}`,
    `Category: ${candidate.category}`,
    `${endpointLabel} ${candidate.endpoint ?? '(not applicable)'}`,
    `Module: ${candidate.component}`,
    `Severity: ${BUGZILLA_SEVERITY[candidate.severity]} / Priority: ${BUGZILLA_PRIORITY[candidate.severity]}`,
    '',
    `Preconditions: ${buildPreconditions(candidate)}`,
    '',
    ...wrap(candidate.narrative),
  ];

  // What it means, why it matters and how to fix it.
  const guidance = developerGuidance(candidate.classification);
  if (guidance) {
    lines.push('', ...wrap(`What this means: ${guidance.meaning}`));
    lines.push('', ...wrap(`Why it matters: ${guidance.why}`));
    lines.push('', ...wrap(`How to fix: ${guidance.fix}`));
  }

  if (candidate.occurrences > 1) {
    lines.push('', `Observed ${candidate.occurrences} times in this run.`);
  }

  if (candidate.affectedEndpoints && candidate.affectedEndpoints.length > 1) {
    // A platform-wide fault lists every endpoint it was seen on.
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

  if (candidate.repro) lines.push('', 'Steps to reproduce:', clamp(candidate.repro, 'repro'));

  // The curl goes last; tokens are a $KPOST_TOKEN placeholder (see curl.ts).
  if (candidate.curl) lines.push('', 'curl:', clamp(candidate.curl, 'curl'));

  // Only for findings asserted on MySQL state, so the reader can check the data.
  if (candidate.verificationSql) {
    lines.push('', 'Database verification SQL:', clamp(candidate.verificationSql, 'sql'));
  }

  lines.push(
    '',
    `Owner: ${candidate.ownerName} <${candidate.assignee}> — maintainer of the ${candidate.product} module`,
    `Environment: ${candidate.environment} (${candidate.baseURL})`,
  );

  // Whether the defect failed every time or intermittently.
  if (candidate.reproduction) {
    const { attempts, failures } = candidate.reproduction;
    const verdict = failures === attempts ? 'confirmed, not flake' : 'INTERMITTENT';
    lines.push(`Reproduction: ${failures}/${attempts} passes failed — ${verdict}`);
  }

  lines.push(
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
    `Host: ${candidate.baseURL}\n` +
    `Check: ${candidate.classification}. Observed ${candidate.occurrences} time(s) this run.` +
    (candidate.correlationId ? `\nCorrelation ID: ${candidate.correlationId}` : '') +
    // A current reproduction against the host actually tested.
    (candidate.curl ? `\n\ncurl (current host):\n${candidate.curl}` : '')
  ).slice(0, BUGZILLA_LIMITS.comment);
}

/**
 * The reopen comment; from the second reopen (`priorReopens`) on, it calls out the repeated cycle.
 */
export function buildReopenComment(
  candidate: BugCandidate,
  resolution: string,
  priorReopens = 0,
): string {
  const cycleNote =
    priorReopens >= 1
      ? `\n\nThis ticket has now been reopened ${priorReopens + 1} time(s) without a lasting fix. ` +
        `Please run the reproduction below yourself and confirm the response before marking FIXED again.`
      : '';
  return (
    `Reopening: this defect was observed again by kpost-testbench_v2 on ${candidate.observedAt} ` +
    `(${candidate.environment}, build ${candidate.build}), after the ticket was resolved ${resolution}. ` +
    `Tracked here rather than under a new ticket number.\n` +
    `Check: ${candidate.classification}.` +
    (candidate.correlationId ? `\nCorrelation ID: ${candidate.correlationId}` : '') +
    (candidate.curl ? `\n\ncurl (current host):\n${candidate.curl}` : '') +
    cycleNote
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
