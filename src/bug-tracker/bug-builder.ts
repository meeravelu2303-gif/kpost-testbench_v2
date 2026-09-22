import { BUGZILLA_LIMITS, BUGZILLA_PRIORITY, BUGZILLA_SEVERITY } from '@config/bugzilla.config';
import { normalizeForFingerprint } from './bug-fingerprint';
import type { BugCandidate } from './bug-candidate';
import { developerGuidance } from './guidance';

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
  if (candidate.browsers?.length) tags.push(`[browser:${candidate.browsers.join(',')}]`);
  return tags.join('');
}

/** Section rule, sized to the 80-column budget below. */
const SECTION_RULE = '-'.repeat(78);

/**
 * Wrap prose to 78 columns, preserving deliberate line breaks.
 *
 * Bugzilla renders a comment inside a <pre> element, which does NOT wrap. A 300-character narrative
 * on one line therefore becomes a horizontal scrollbar, and everything past the fold is invisible
 * until the reader drags. Pre-formatted blocks (curl, SQL, JSON) are NOT passed through this — they
 * are wrapped at the point they are built, where the syntax is known and a break can be put
 * somewhere legal.
 */
function wrap(text: string, width = 78, indent = '  '): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (!paragraph.trim()) {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of paragraph.trim().split(/\s+/)) {
      if (line && (line + ' ' + word).length + indent.length > width) {
        out.push(indent + line);
        line = word;
      } else {
        line = line ? line + ' ' + word : word;
      }
    }
    if (line) out.push(indent + line);
  }
  return out;
}

/** A pre-formatted block (curl, SQL, a response body): indented, never re-wrapped. */
function block(text: string, indent = '  '): string[] {
  return text.split('\n').map((line) => (line.trim() ? indent + line : ''));
}

/** "LABEL  value" with the labels aligned into a column. */
function field(label: string, value: string | number, width = 16): string {
  return `  ${label.padEnd(width)}${value}`;
}

function section(title: string): string[] {
  return ['', title, SECTION_RULE];
}

/**
 * The ticket body a developer reads in Bugzilla.
 *
 * ## Why plain text, and why no Markdown
 *
 * This Bugzilla is 5.2, which has no Markdown support for comments — no `is_markdown` field on the
 * REST comment object and no markdown parameter on the instance. Asterisks written for bold would
 * be shown literally, and a triple-backtick fence would appear as three backticks. Comments are
 * rendered inside a <pre>, so the monospace panel a reader sees is the SKIN doing that to every
 * comment on the instance, not something a payload can opt into or out of.
 *
 * What a payload CAN control, and what this layout uses, is structure that survives a fixed-width
 * pre: uppercase section headers with a rule under them, labels aligned into a column, and every
 * line kept inside 78 characters so nothing needs horizontal scrolling.
 *
 * ## Section order
 *
 * Endpoint, then expected, then actual, then the two things that let the reader check it
 * themselves — the curl and the SQL — and finally the environment and how reliably it reproduced.
 * A reader who stops after twenty lines still has the defect; a reader who wants to verify it has
 * everything without leaving the ticket.
 *
 * Sections with no data are omitted entirely rather than printed empty, so a UI defect does not
 * carry a blank DATABASE VERIFICATION heading implying a check nobody ran.
 */
export function buildDescription(candidate: BugCandidate): string {
  const lines: string[] = [];

  /* ---- SUMMARY & ENDPOINT ------------------------------------------------------------------ */
  lines.push('SUMMARY & ENDPOINT', SECTION_RULE);
  if (candidate.endpoint) lines.push(`  ${candidate.endpoint}`);
  lines.push(field('Module', `${candidate.product} / ${candidate.component}`));
  lines.push(field('Severity', candidate.severity));
  lines.push(field('Found by', `${candidate.classification}  (${candidate.category})`));
  if (candidate.affectedEndpoints && candidate.affectedEndpoints.length > 1) {
    // Only true when the fault really does span endpoints. On a single-endpoint defect this note
    // would send the reader looking for a list that is not there.
    lines.push(field('Note', 'representative endpoint — full list under SCOPE below'));
  }
  lines.push('');
  lines.push(...wrap(candidate.narrative));

  const guidance = developerGuidance(candidate.classification);
  if (guidance) {
    lines.push(...section('WHAT THIS MEANS'));
    lines.push(...wrap(guidance.meaning));
    lines.push('');
    lines.push('  Why it matters:');
    lines.push(...wrap(guidance.why, 78, '    '));
    lines.push('');
    lines.push('  How to fix:');
    lines.push(...wrap(guidance.fix, 78, '    '));
  }

  /* ---- EXPECTED / ACTUAL -------------------------------------------------------------------- */
  lines.push(...section('EXPECTED RESULT'));
  lines.push(...block(clamp(candidate.expected, 'expected')));

  lines.push(...section('ACTUAL RESULT'));
  lines.push(...block(clamp(candidate.actual, 'response')));
  if (candidate.responseBody) {
    lines.push('');
    lines.push(`  Response body (HTTP ${candidate.responseStatus ?? '?'}):`);
    lines.push(...block(clamp(candidate.responseBody, 'response body'), '    '));
  }

  /* ---- REPRODUCTION ------------------------------------------------------------------------- */
  if (candidate.repro) {
    lines.push(...section('STEPS TO REPRODUCE'));
    lines.push(...block(clamp(candidate.repro, 'repro')));
  }

  /*
   * The curl carries real identifiers and a $KPOST_TOKEN placeholder for the bearer token: the
   * identifiers are what make it runnable, the token is the one value that must never be pasted
   * into a tracker. See src/bug-tracker/curl.ts.
   */
  if (candidate.curl) {
    lines.push(...section('REPRODUCIBLE cURL'));
    lines.push(...block(clamp(candidate.curl, 'curl')));
  }

  if (candidate.verificationSql) {
    lines.push(...section('DATABASE VERIFICATION SQL'));
    lines.push(...block(clamp(candidate.verificationSql, 'sql')));
  }

  /* ---- SCOPE -------------------------------------------------------------------------------- */
  if (candidate.affectedEndpoints && candidate.affectedEndpoints.length > 1) {
    lines.push(...section('SCOPE — ONE FAULT, MANY ENDPOINTS'));
    lines.push(
      ...wrap(
        `${candidate.affectedEndpoints.length} endpoints show this same fault. One shared fix ` +
          `resolves all of them — they are listed so triage can confirm the scope rather than ` +
          `hunt for it.`,
      ),
    );
    lines.push('');
    for (const endpoint of candidate.affectedEndpoints) lines.push(`    ${endpoint}`);
  }

  /* ---- ENVIRONMENT & REPRODUCIBILITY -------------------------------------------------------- */
  lines.push(...section('ENVIRONMENT & REPRODUCIBILITY'));
  lines.push(field('Environment', `${candidate.environment} (${candidate.baseURL})`));
  if (candidate.reproduction) {
    const { attempts, failures } = candidate.reproduction;
    const verdict =
      failures === attempts
        ? 'confirmed, not flake'
        : 'INTERMITTENT — treat timing as part of the defect';
    lines.push(field('Reproduction', `${failures}/${attempts} passes failed — ${verdict}`));
  }
  if (candidate.occurrences > 1) {
    lines.push(field('Occurrences', `${candidate.occurrences} times in this run`));
  }
  if (candidate.browsers?.length) {
    lines.push(field('Browsers', candidate.browsers.join(', ')));
  }
  if (candidate.correlationId) {
    lines.push(field('Correlation ID', candidate.correlationId));
    lines.push(field('', '(search the application logs for it)'));
  }
  lines.push(field('Observed', candidate.observedAt));
  lines.push(field('Owner', `${candidate.ownerName} <${candidate.assignee}>`));
  lines.push(field('Filed by', `kpost-testbench_v2 build ${candidate.build}`));
  lines.push(field('Test run', candidate.testRunId));

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
    // The current, runnable reproduction against the host actually tested — so the ticket carries an
    // up-to-date command even when its original description was filed against an older host.
    (candidate.curl ? `\n\ncurl (current host):\n${candidate.curl}` : '')
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
