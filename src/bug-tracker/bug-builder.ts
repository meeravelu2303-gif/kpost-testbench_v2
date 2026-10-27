import {
  BUGZILLA_LIMITS,
  BUGZILLA_PRIORITY,
  BUGZILLA_SEVERITY,
  browserForProject,
} from '@config/bugzilla.config';
import { normalizeForFingerprint } from './bug-fingerprint';
import type { BugCandidate } from './bug-candidate';
import { developerGuidance, firstSentence } from './guidance';

/**
 * Turns a candidate into the ticket shape this Bugzilla expects. The description is line-anchored
 * (`Classification:`, `Summary:`, `Expected:`, `Actual:`, `curl:` …) because the BUGZILLA-UI
 * tracker parses those labels.
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

function clamp(value: string, label: string, max: number = BUGZILLA_LIMITS.snippet): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n… [${label} cut short (${value.length} characters); the full text is in the attached evidence file]`;
}

/** Expected / Actual / a reply body stay readable in the ticket; the attachment has all of it. */
const BLOCK_MAX = 2_000;

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

const BROWSER_NAME: Record<string, string> = {
  chromium: 'Chromium',
  firefox: 'Firefox',
  webkit: 'WebKit (Safari)',
};

/** The Summary block: the candidate's own plain sentences, then how often it failed. */
function summaryText(candidate: BugCandidate): string {
  let summary = candidate.summary ?? candidate.narrative;
  const counted = !candidate.systemic && !candidate.classification.startsWith('accessibility.');
  if (candidate.reproduction) {
    const { attempts, failures } = candidate.reproduction;
    summary +=
      failures === attempts
        ? ` It failed ${failures} of ${attempts} tries, so it is not a one-off.`
        : ` It failed ${failures} of ${attempts} tries: it comes and goes.`;
  } else if (counted && candidate.occurrences > 1) {
    summary += ` Seen ${candidate.occurrences} times in this run.`;
  }
  return summary;
}

/** Numbered steps a developer can follow in the product itself, never a bench command. */
function buildSteps(candidate: BugCandidate): string {
  if (candidate.repro) return clamp(candidate.repro, 'steps');
  if (candidate.source === 'api') {
    return [
      '1. Log in with a test account and put its token in $KPOST_TOKEN.',
      candidate.curl
        ? '2. Run the curl below.'
        : `2. Call ${candidate.endpoint ?? 'the endpoint'} the way Expected describes.`,
      '3. Compare the reply with Expected.',
    ].join('\n');
  }
  const browsers = [...new Set((candidate.browsers ?? []).map(browserForProject))]
    .map((b) => BROWSER_NAME[b] ?? b)
    .join(' or ');
  const steps = [
    `1. Sign in to ${candidate.baseURL} with a test account${browsers ? ` in ${browsers}` : ''}.`,
  ];
  if (candidate.classification.startsWith('accessibility.')) {
    steps.push(
      '2. Open each screen listed under Actual.',
      '3. Run an accessibility checker (for example axe DevTools) and look for the rule in the Summary.',
    );
  } else if (candidate.systemic) {
    steps.push('2. Open any screen (Home, Katchup, Kall, KMail …) and wait for it to load.');
  } else {
    steps.push(
      `2. Open the ${candidate.component} screen.`,
      '3. Do what Expected describes, and compare the result with Actual.',
    );
  }
  if (candidate.proof?.length)
    steps.push('The screenshot and video from the test run are attached.');
  return steps.join('\n');
}

/**
 * The ticket body, short and in plain English: header lines, Summary, Steps, Expected, Actual,
 * How to fix, curl, then who/where/when. Every label is one the BUGZILLA-UI tracker parses
 * (`backend/src/lib/defectReport.ts`, `DescriptionReport.tsx`); text without a label is dropped
 * there. Plain text only: this Bugzilla 5.2 ignores Markdown.
 */
export function buildDescription(candidate: BugCandidate): string {
  // `Representative endpoint:` is how verify-resolve finds a platform-wide ticket's scope.
  const endpointLabel = candidate.systemic ? 'Representative endpoint:' : 'Endpoint:';
  const lines = [
    `Classification: ${candidate.classification}`,
    `Category: ${candidate.category}`,
    ...(candidate.endpoint ? [`${endpointLabel} ${candidate.endpoint}`] : []),
    `Module: ${candidate.component}`,
    `Severity: ${BUGZILLA_SEVERITY[candidate.severity]} / Priority: ${BUGZILLA_PRIORITY[candidate.severity]}`,
    '',
    'Summary:',
    ...wrap(summaryText(candidate)),
    '',
    'Steps to reproduce:',
    buildSteps(candidate),
    '',
    'Expected:',
    clamp(candidate.expected, 'expected', BLOCK_MAX),
    '',
    'Actual:',
    clamp(candidate.actual, 'actual', BLOCK_MAX),
  ];

  // Unlabelled lines join the block above them in the tracker, so these read as part of Actual.
  if (candidate.failedApiCalls?.length) {
    lines.push(
      '',
      'API calls that failed while the screen loaded:',
      ...candidate.failedApiCalls.map((call) => `  - ${call}`),
    );
  }
  if (candidate.affectedEndpoints && candidate.affectedEndpoints.length > 1) {
    lines.push(
      '',
      `Affects ${candidate.affectedEndpoints.length} endpoints — one shared fix resolves all of them:`,
      ...candidate.affectedEndpoints.map((endpoint) => `  - ${endpoint}`),
    );
  }
  // Only for findings asserted on MySQL state, so the reader can check the data.
  if (candidate.verificationSql) {
    lines.push('', 'Check in the database:', clamp(candidate.verificationSql, 'sql'));
  }

  // The reply body, unless Actual already quotes it.
  const body = candidate.responseBody?.trim();
  if (body && !candidate.actual.includes(body.slice(0, 60))) {
    lines.push(
      '',
      `Response body (HTTP ${candidate.responseStatus ?? '?'}):`,
      clamp(body, 'response body', BLOCK_MAX),
    );
  }

  const guidance = developerGuidance(candidate.classification);
  if (guidance) lines.push('', 'How to fix:', ...wrap(firstSentence(guidance.fix)));

  // Tokens are a $KPOST_TOKEN placeholder (see curl.ts).
  if (candidate.curl) lines.push('', 'curl:', clamp(candidate.curl, 'curl'));

  const at = Number.isNaN(Date.parse(candidate.observedAt))
    ? candidate.observedAt
    : `${new Date(candidate.observedAt).toISOString().replace('T', ' ').slice(0, 16)} UTC`;
  lines.push(
    '',
    `Owner: ${candidate.ownerName} <${candidate.assignee}>`,
    `Environment: ${candidate.baseURL}`,
    `Run date: ${at}`,
    ...(candidate.correlationId ? [`Correlation ID: ${candidate.correlationId}`] : []),
    // The tracker's Source reads "Filed by: manual…" as a person's bug, anything else as automation.
    candidate.filedBy === 'manual'
      ? `Filed by: manual test, written with the KPost test bench (run ${candidate.testRunId})`
      : `Filed by: kpost-testbench_v2 automated test, run ${candidate.testRunId}`,
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
    candidate.responseBody ? `Response body (HTTP ${candidate.responseStatus ?? '?'}):` : '',
    candidate.responseBody ?? '',
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
