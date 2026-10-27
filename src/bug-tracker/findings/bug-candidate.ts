import type { RequestSpec } from '@api/client/request-builder';
import {
  categoryFor,
  type BugCategory,
  type BugSource,
  type BugzillaConfig,
} from '@config/bugzilla.config';
import { componentFor, suiteFor, type SuiteId } from '@config/ownership.config';
import type { Severity, ValidationReport, ValidationResult } from '@engine/validation-result';
import { maskSensitive, maskString } from '@utils/masking';
import { buildCurl } from '../ticket/curl';
import { developerGuidance, firstSentence } from '../ticket/guidance';
import {
  apiFingerprint,
  normalizeForFingerprint,
  systemicFingerprint,
  uiFingerprint,
  uiSystemicFingerprint,
} from './bug-fingerprint';

/**
 * Validators whose failure is one platform-wide fault (shared gateway or auth filter), filed as a
 * single ticket. Everything else stays per-endpoint: the same validator failing twice is usually
 * two fixes.
 */
const SYSTEMIC_VALIDATORS = new Set<string>([
  'security.security-headers',
  'authentication.missing-token',
  'authentication.invalid-token',
  'authentication.malformed-token',
  'authentication.expired-token',
  'security.jwt',
]);

function isSystemicFinding(validatorName: string, message: string): boolean {
  if (SYSTEMIC_VALIDATORS.has(validatorName)) return true;
  // Auth-rejection envelopes are the shared filter's; a bad "primary (" response is the endpoint's.
  if (validatorName === 'response.error-format') return !message.includes('primary (');
  // A disclosed technology header is the shared gateway; a body leak (stack trace, SQL, path) is
  // the endpoint's own bug.
  if (validatorName === 'security.information-disclosure') {
    const headerDisclosure =
      /server header|powered-by|x-powered|technology header|via header/i.test(message);
    const bodyLeak =
      /stack|traceback|\bsql\b|file path|filepath|\/usr\/|\/var\/|credential|secret key|private key/i.test(
        message,
      );
    return headerDisclosure && !bodyLeak;
  }
  return false;
}

/**
 * A stable signature for a systemic fault, independent of endpoint and probe order, so one root
 * cause is one ticket. The raw message lists probes in a run-dependent order and would split it
 * into duplicates.
 */
export function systemicSignature(validatorName: string, message: string): string {
  const m = message.toLowerCase();
  if (validatorName === 'security.information-disclosure') {
    const headers: string[] = [];
    if (/server header/.test(m)) headers.push('server');
    if (/x-powered|powered-by/.test(m)) headers.push('x-powered-by');
    if (/via header/.test(m)) headers.push('via');
    if (/x-aspnet|asp.net|x-runtime/.test(m)) headers.push('x-aspnet-version');
    return headers.length ? `header:${[...new Set(headers)].sort().join(',')}` : 'header';
  }
  if (validatorName === 'response.error-format') return 'auth-error-envelope';
  if (validatorName === 'security.security-headers') {
    const names = [
      ...m.matchAll(
        /(content-security-policy|x-frame-options|x-content-type-options|strict-transport-security|referrer-policy|permissions-policy|cache-control)/g,
      ),
    ].map((x) => x[1]);
    return names.length ? `missing:${[...new Set(names)].sort().join(',')}` : 'missing';
  }
  // Auth-filter validators and JWT: one platform-wide ticket per validator.
  return validatorName;
}

/** A stable one-line headline for a systemic ticket's title and Actual. */
function systemicHeadline(validatorName: string, message: string): string {
  const sig = systemicSignature(validatorName, message);
  switch (validatorName) {
    case 'security.information-disclosure': {
      const hdrs = sig.replace(/^header:?/, '').replace(/,/g, ', ') || 'technology';
      return `the ${hdrs} response header discloses server/technology version information`;
    }
    case 'response.error-format':
      return 'authentication-rejection responses do not use the standard error envelope';
    case 'security.security-headers': {
      const names = sig.replace(/^missing:?/, '').replace(/,/g, ', ') || 'required';
      return `responses are missing expected security headers (${names})`;
    }
    default:
      return `the shared auth filter does not satisfy "${validatorName}" across endpoints`;
  }
}

/**
 * A defect ready to be filed: one candidate is one Bugzilla ticket. Product, component and owner
 * come from the endpoint's module (src/config/ownership.config.ts).
 */
export interface BugCandidate {
  /** Dedupe tag, e.g. `KP-A1B2C3`. Written into the summary as `[KP-A1B2C3]`. */
  id: string;
  source: 'api' | 'ui';
  /** Owning module. */
  suiteId: SuiteId;
  title: string;
  /** Prose that explains the finding. The validity gate and known-false-positives read it. */
  narrative: string;
  /**
   * The ticket's `Summary:` block: 2-4 plain sentences on what is broken and why it matters
   * (owner, 2026-10-26). Display only, so the gates never change; unset = `narrative`.
   */
  summary?: string;
  severity: Severity;
  category: BugCategory;
  /** What kind of check found it: the validator name, or `UI Test Failure`. */
  classification: string;
  product: string;
  component: string;
  version: string;
  /** Developer who maintains this module; set as the ticket's assignee. */
  assignee: string;
  ownerName: string;
  endpoint?: string;
  expected: string;
  actual: string;
  repro?: string;
  /** Body of the primary response, quoted in the ticket. */
  responseBody?: string;
  responseStatus?: number;
  /** A copy-pasteable command that reproduces the failure. */
  curl?: string;
  /** SQL that shows the same discrepancy in the database, for findings asserted on MySQL state. */
  verificationSql?: string;
  /** How the reproduction gate scored it: `failures` of `attempts` passes failed. */
  reproduction?: { attempts: number; failures: number };
  correlationId?: string;
  /** Browser projects that observed a UI failure. */
  browsers?: string[];
  /** API calls that failed while a UI screen loaded ("METHOD /path → STATUS"), shown after Actual. */
  failedApiCalls?: readonly string[];
  /** `[source:]` whiteboard tag: unset = `automation`; `manual` for a hand-written bug. */
  filedBy?: BugSource;
  occurrences: number;
  environment: string;
  baseURL: string;
  build: string;
  testRunId: string;
  observedAt: string;
  /** Full, unabridged evidence for the ticket attachment. */
  evidence: Record<string, unknown>;
  /**
   * Screenshot/video files on disk attached to a UI ticket (API tickets use curl + body instead).
   */
  proof?: ProofFile[];
  /** A platform-wide fault (gateway/auth filter) — filed once, listing every endpoint it hits. */
  systemic?: boolean;
  /** For a systemic defect: every endpoint the same fault was observed on, listed in the ticket. */
  affectedEndpoints?: string[];
  /** The same endpoints with their module and sighting count, for the tracker's "Affected scope". */
  affectedScope?: { endpoint: string; module: string; count: number }[];
  /**
   * Why a brand-new candidate is held for human review instead of auto-filed (create path only).
   */
  reviewHold?: string;
}

/** Ends a sentence with a full stop unless it already has one. */
function sentence(value: string): string {
  const t = value.replace(/\s+/g, ' ').trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/** A test title as plain text: tags (`@ui`) removed, first letter capitalised. */
export function plainTitle(title: string): string {
  const t = title.replace(/\s*@[\w-]+/g, '').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** The Summary of an API bug: what is broken, then why it matters. */
function apiSummary(result: ValidationResult): string {
  // A flow-confirmed business rule says the rule itself, in the words it was documented in.
  const rule = /^\S+ violated — (.+)$/s.exec(result.message)?.[1];
  if (rule) return `This rule is broken: ${sentence(maskString(rule))}`;
  const guidance = developerGuidance(result.validatorName);
  // Only the first "why" sentence, so the Summary stays 2-4 sentences.
  if (guidance) return `${sentence(guidance.meaning)} ${sentence(firstSentence(guidance.why))}`;
  return `The "${result.validatorName}" check failed: ${sentence(maskString(result.message).slice(0, 300))}`;
}

/** The path out of an endpoint label like "POST /v2/common/validateOTP/". */
function endpointPath(label: string): string {
  const space = label.indexOf(String.fromCharCode(32));
  return space > 0 ? label.slice(space + 1) : label;
}

/** The request of the first failing sub-check, when a probe recorded one. */
function failingRequest(result: ValidationResult): RequestSpec | undefined {
  return result.details?.find((detail) => detail.status === 'FAILED' && detail.request)?.request;
}

const text = (value: unknown): string => {
  if (value === undefined || value === null) return '(none)';
  return maskString(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
};

/** A single expected/actual value as a short human string: `[401]` → `401`, `[400,401]` → `400 or 401`. */
const oneValue = (value: unknown): string => {
  if (value === undefined || value === null) return '(none)';
  if (Array.isArray(value)) return value.map((v) => String(v)).join(' or ');
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return maskString(typeof value === 'string' ? value : JSON.stringify(value));
};

/**
 * Expected/Actual as one aligned `case → value` line per failed sub-case, so the ticket reads as a
 * line-by-line diff. Falls back to the raw values for single-shot validators.
 */
function renderExpectedActual(result: ValidationResult): { expected: string; actual: string } {
  const failed = (result.details ?? []).filter((d) => d.status === 'FAILED');
  if (failed.length > 0) {
    const width = Math.min(Math.max(...failed.map((d) => d.name.length)), 40);
    // The case name is a static validator label, so only the value is mask-checked.
    const row = (name: string, value: unknown): string =>
      `${name.slice(0, 40).padEnd(width)}  →  ${oneValue(value)}`;
    return {
      expected: failed.map((d) => row(d.name, d.expected)).join('\n'),
      actual: failed.map((d) => row(d.name, d.actual)).join('\n'),
    };
  }
  return { expected: text(result.expected), actual: text(result.actual) };
}

/** Words from a spec path and test title, used to find the UI screen's component. */
export function screenTokens(file: string, title: string): string[] {
  // File name and title only: a module folder must not move a bug to another component.
  const name = file.split(/[\\/]/).pop() ?? file;
  return `${name} ${title}`
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter(Boolean);
}

/**
 * Negative-input probes. KPost fields are often optional filters, so accepting bad input (2xx) is
 * lenient by design; these findings are filed only when the endpoint crashed (5xx).
 */
const LENIENT_INPUT_VALIDATORS = new Set<string>([
  'request.null-value',
  'request.empty-body',
  'request.empty-value',
  'request.data-type',
  'request.boundary-value',
  'request.enum',
  'request.format',
  'request.required-fields',
  'request.unknown-fields',
  'request.invalid-payload',
  'request.method-not-allowed',
]);

export function isLenientAcceptanceFalsePositive(result: ValidationResult): boolean {
  if (!LENIENT_INPUT_VALIDATORS.has(result.validatorName)) return false;
  const failed = (result.details ?? []).filter((d) => d.status === 'FAILED');
  if (!failed.length) return false;
  // A 5xx on bad input is a real crash; suppress only when every failing case was accepted.
  const crashed = failed.some((d) => {
    const code = Number(d.actual);
    return Number.isFinite(code) && code >= 500 && code < 600;
  });
  return !crashed;
}

/** One candidate per FAILED validation; WARNING and SKIPPED never become tickets. */
export function candidatesFromReport(
  report: ValidationReport,
  context: { baseURL: string },
  config: BugzillaConfig,
): BugCandidate[] {
  return report.results
    .filter((result) => result.status === 'FAILED')
    .filter((result) => !isLenientAcceptanceFalsePositive(result))
    .map((result) => fromValidationResult(result, report, context, config));
}

function fromValidationResult(
  result: ValidationResult,
  report: ValidationReport,
  context: { baseURL: string },
  config: BugzillaConfig,
): BugCandidate {
  const suite = suiteFor(report.suite);
  const systemic = isSystemicFinding(result.validatorName, result.message);
  const systemicHead = systemic ? systemicHeadline(result.validatorName, result.message) : '';
  const id = systemic
    ? systemicFingerprint({
        prefix: config.tagPrefix,
        validatorName: result.validatorName,
        // Stable signature, NOT the volatile probe concatenation — so one root cause is one ticket.
        message: systemicSignature(result.validatorName, result.message),
      })
    : apiFingerprint({
        prefix: config.tagPrefix,
        endpointId: result.endpointId,
        validatorName: result.validatorName,
        message: result.message,
      });
  return {
    id,
    source: 'api',
    suiteId: suite.id,
    title: systemic
      ? `Platform-wide — ${systemicHead}`
      : `${result.endpoint}: ${maskString(result.message)}`,
    narrative: systemic
      ? `The centralized validation engine ran "${result.validatorName}" and found the same failure ` +
        `on ${result.endpoint} that it finds across the ${suite.label}: this is ONE shared root cause ` +
        `(the API gateway or the auth filter), not a defect specific to this endpoint. It affects ` +
        `every endpoint listed below, and one fix resolves all of them — filed as a single ticket so ` +
        `the queue is not flooded with near-duplicates. Category ${result.category}, severity ${result.severity}.`
      : `The centralized validation engine ran "${result.validatorName}" against ${result.endpoint} ` +
        `in the ${suite.label} under the ${report.profile} profile, and the endpoint did not satisfy it. ` +
        `Category ${result.category}, severity ${result.severity}. ` +
        `Every request of this run carries a correlation ID, so the exchange can be traced in the ` +
        `application logs (see below).`,
    summary: systemic
      ? `${sentence(developerGuidance(result.validatorName)?.meaning ?? systemicHead)} It happens on ` +
        `every endpoint listed under Actual, so it comes from one shared place (the API gateway or ` +
        `the login filter): one fix there fixes all of them.`
      : apiSummary(result),
    severity: result.severity,
    category: categoryFor(result.category),
    classification: result.validatorName,
    product: suite.bugzilla.product,
    // A gateway/auth fault goes to the product's platform-security component, not the catch-all.
    component: systemic
      ? (suite.bugzilla.systemicComponent ?? suite.bugzilla.fallbackComponent)
      : componentFor(suite, report.tags),
    version: suite.bugzilla.version,
    assignee: suite.owner.email,
    ownerName: suite.owner.name,
    endpoint: result.endpoint,
    ...(systemic
      ? {
          expected: 'The shared gateway/auth layer satisfies this check on every endpoint.',
          actual: `${systemicHead} — observed on this and other endpoints (see the affected list below).`,
        }
      : renderExpectedActual(result)),
    /** What the endpoint actually replied, quoted the way the existing tickets here do. */
    responseBody: report.primary?.body?.trim() ? report.primary.body : undefined,
    responseStatus: report.primary?.status,
    // The developer has the app, not our repo, so the reproduction is a curl, not a bench command.
    curl: buildCurl({
      method: report.method,
      // `result.endpoint` is a label ("POST /v2/…"), not a path.
      path: endpointPath(result.endpoint),
      baseUrl: context.baseURL,
      // The failing probe's request: the happy-path call would just return 200.
      request: failingRequest(result) ?? report.request,
      // Token header only where the contract needs one; omitting it would reproduce as a false 401.
      authenticated: report.requiresAuth ?? Boolean(report.request?.headers?.Authorization),
    }),
    correlationId: result.correlationId,
    reproduction: result.reproduction,
    occurrences: 1,
    environment: report.environment,
    baseURL: context.baseURL,
    build: report.build,
    testRunId: report.testRunId,
    observedAt: result.timestamp,
    systemic,
    affectedEndpoints: systemic ? [result.endpoint] : undefined,
    affectedScope: systemic
      ? [{ endpoint: result.endpoint, module: componentFor(suite, report.tags), count: 1 }]
      : undefined,
    evidence: maskSensitive({
      module: suite.label,
      validator: result.validatorName,
      category: result.category,
      severity: result.severity,
      endpoint: result.endpoint,
      endpointId: result.endpointId,
      profile: report.profile,
      expected: result.expected,
      actual: result.actual,
      details: result.details,
      correlationId: result.correlationId,
      reproduction: result.reproduction,
      error: result.error,
    }),
  };
}

/** A binary artifact to attach to a ticket as proof (a screenshot or a video on disk). */
export interface ProofFile {
  /** Absolute or cwd-relative path to the file on disk. */
  path: string;
  /** MIME type, e.g. `image/png` or `video/webm`. */
  contentType: string;
  /** Human label shown as the attachment description, e.g. `Screenshot (chromium)`. */
  label: string;
}

export interface UiFailureInput {
  file: string;
  title: string;
  /** First meaningful line of the Playwright error. */
  message: string;
  /** Full error text, for the attachment. */
  fullMessage: string;
  browser: string;
  environment: string;
  baseURL: string;
  build: string;
  testRunId: string;
  observedAt: string;
  /** Screenshot / video captured for this failure, uploaded to the ticket as proof. */
  proof?: ProofFile[];
  /** Bounced to the sign-in screen, so the screen never loaded (a session issue, not a defect). */
  endedOnAuthScreen?: boolean;
  /**
   * Non-2xx API calls while the screen loaded ("METHOD /path → STATUS"), named as the likely cause.
   */
  failedApiCalls?: readonly string[];
}

/**
 * Shared background components that fail the same way on every screen, keyed by the failing
 * request's hostname; their failures collapse into one ticket.
 */
const KNOWN_BACKGROUND_WIDGETS: ReadonlyArray<{
  hostMatch: string;
  causeKey: string;
  label: string;
}> = [
  {
    hostMatch: 'rss2json.com',
    causeKey: 'rss-widget-cors',
    label: 'the news/RSS widget that appears on every screen',
  },
];

/** The hostname out of a URL embedded in an error message, tolerant of the bench's own spacing quirks. */
function hostnameIn(message: string): string | undefined {
  const m = /https?:\s*\/*([a-zA-Z0-9.-]+)/i.exec(message);
  return m?.[1];
}

/**
 * Rewrites a raw browser failure into plain English, and marks known background-widget failures as
 * systemic so every screen's occurrence collapses into one ticket.
 */
function humanizeUiFailure(message: string): {
  classification: string;
  actual: string;
  systemic?: { causeKey: string; narrative: string };
} {
  const host = hostnameIn(message);
  if (host) {
    const widget = KNOWN_BACKGROUND_WIDGETS.find((w) => host.includes(w.hostMatch));
    if (widget) {
      return {
        classification: 'A shared background component fails on every screen, not just this one',
        actual:
          `${widget.label} tried to load something from an outside website (${host}) and that ` +
          `call failed, which crashed the page. This is not specific to this screen — the same ` +
          `widget is mounted everywhere, so every screen hits the same failure. Technical detail: ` +
          message,
        systemic: {
          causeKey: widget.causeKey,
          narrative:
            `${widget.label.charAt(0).toUpperCase()}${widget.label.slice(1)} fails to load an ` +
            `outside feed through ${host}, and the resulting error crashes whichever screen ` +
            `happens to be open at the time — Home, Katchup, Kall, KMail, Profile, Settings, and ` +
            `every other screen that renders this widget are all affected the same way. Fix the ` +
            `one shared component and every screen is fixed at once.`,
        },
      };
    }
    return {
      classification: 'A background request to an outside website failed and crashed the page',
      actual: `While using the screen, a background request to ${host} failed, and the page crashed as a result. Technical detail: ${message}`,
    };
  }

  if (/Test timeout of \d+ms exceeded/i.test(message)) {
    return {
      classification: 'The screen became unresponsive and the check timed out waiting for it',
      actual: `The check gave up waiting for the screen to respond. Technical detail: ${message}`,
    };
  }
  if (/TimeoutError:\s*locator\.click/i.test(message)) {
    return {
      classification: 'A control on the screen never became clickable',
      actual: `A button or control the check tried to click never became available to click, so the check gave up. Technical detail: ${message}`,
    };
  }
  if (/ChunkLoadError/i.test(message)) {
    return {
      classification: 'Part of the app failed to load (a missing or broken code chunk)',
      actual: `A piece of the app's own code failed to download and load in the browser. Technical detail: ${message}`,
    };
  }
  if (/Minified React error/i.test(message)) {
    return {
      classification: 'The page crashed due to an internal React error',
      actual: `The page's own code crashed with an internal React error. Technical detail: ${message}`,
    };
  }
  if (/keyboard use crashed the screen/i.test(message)) {
    return {
      classification: 'Using the keyboard to navigate the screen crashes it',
      actual: `Tabbing through the screen's controls with the keyboard crashed it. Technical detail: ${message}`,
    };
  }
  if (/the screen crashed when the network dropped/i.test(message)) {
    return {
      classification: 'The screen crashes if the network connection drops',
      actual: `When the network connection was interrupted, the screen crashed instead of showing an error. Technical detail: ${message}`,
    };
  }

  // No recognised pattern — still return something readable rather than the raw string verbatim.
  return { classification: 'UI Test Failure', actual: message };
}

/** UI product from the spec path: `tests/admin-ui/` is the Admin UI, everything else the KPost UI. */
export function uiSuiteForFile(file: string): 'kpost-ui' | 'admin-ui' {
  return /(^|[\\/])tests[\\/]admin-ui[\\/]/.test(file) ? 'admin-ui' : 'kpost-ui';
}

/** Turns a browser test failure into a candidate for the UI module and its developer. */
export function candidateFromUiFailure(
  input: UiFailureInput,
  config: BugzillaConfig,
): BugCandidate {
  const suite = suiteFor(uiSuiteForFile(input.file));
  // The component doubles as the screen name for the reproduction steps.
  const component = componentFor(suite, screenTokens(input.file, input.title));
  // A lost session proves nothing about the screen; mark it an auth drop for the validity gate.
  const humanized = input.endedOnAuthScreen
    ? {
        classification: 'The test lost its login session and was bounced to the sign-in screen',
        actual:
          'auth session dropped — during this test the account was logged out (the page ended on ' +
          'the login screen and background requests returned HTTP 401), so the screen under test ' +
          'never loaded. This is a test-session / auth-reliability issue, not a defect in this screen.',
      }
    : humanizeUiFailure(input.message);
  // Failing API calls during load usually mean the API contract changed and the UI did not.
  const apiCalls = input.endedOnAuthScreen ? [] : [...(input.failedApiCalls ?? [])];
  const apiCauseNarrative =
    !input.endedOnAuthScreen && input.failedApiCalls && input.failedApiCalls.length
      ? `\n\nLikely API cause (contract drift — the UI did not handle these responses): while this ` +
        `screen was loading, these API calls returned an unexpected status, which the UI does not ` +
        `handle:\n${input.failedApiCalls.map((c) => `  • ${c}`).join('\n')}\nEither the UI must handle ` +
        `the new response, or the API must restore the documented one — this is likely two bugs ` +
        `(file both halves).`
      : '';

  const id = humanized.systemic
    ? uiSystemicFingerprint({ prefix: config.tagPrefix, causeKey: humanized.systemic.causeKey })
    : uiFingerprint({
        prefix: config.tagPrefix,
        file: input.file,
        title: input.title,
        message: input.message,
      });

  return {
    id,
    source: 'ui',
    suiteId: suite.id,
    title: humanized.systemic
      ? `App-wide: ${humanized.classification}`
      : `${input.title}: ${maskString(input.message)}`,
    // Application-level wording: no internal file paths or test commands.
    narrative: humanized.systemic
      ? humanized.systemic.narrative
      : `A front-end (UI) defect on the ${suite.label} at ${input.baseURL}, seen in ${input.browser}. ` +
        `To reproduce: sign in with a test account and open the ${component} screen, then exercise ` +
        `"${input.title}". Expected vs Actual are below.${apiCauseNarrative}`,
    summary: humanized.systemic
      ? undefined
      : `On the ${component} screen, this check failed: "${plainTitle(input.title)}".` +
        (humanized.classification === 'UI Test Failure'
          ? ''
          : ` ${sentence(humanized.classification)}`) +
        (apiCalls.length
          ? ` ${apiCalls.length} API call(s) failed while the screen loaded (listed under Actual), ` +
            `so the cause may be in the API.`
          : ''),
    severity: 'HIGH',
    category: 'Functional',
    classification: humanized.classification,
    product: suite.bugzilla.product,
    component,
    version: suite.bugzilla.version,
    assignee: suite.owner.email,
    ownerName: suite.owner.name,
    // A UI test's title states the behaviour it expects.
    expected: humanized.systemic
      ? 'Every screen loads and works without errors.'
      : sentence(plainTitle(input.title)),
    actual: maskString(humanized.actual),
    ...(apiCalls.length ? { failedApiCalls: apiCalls } : {}),
    browsers: [input.browser],
    occurrences: 1,
    environment: input.environment,
    baseURL: input.baseURL,
    build: input.build,
    testRunId: input.testRunId,
    observedAt: input.observedAt,
    evidence: maskSensitive({
      // Product-level module only, never internal repo paths.
      module: suite.label,
      screen: component,
      title: input.title,
      browser: input.browser,
      error: input.fullMessage,
      ...(input.failedApiCalls && input.failedApiCalls.length
        ? { failedApiCalls: [...input.failedApiCalls] }
        : {}),
    }),
    proof: input.proof,
  };
}

/**
 * Merges in-run sightings of one API fault that differ only in probe counts ("17/31" vs "18/32").
 * The fingerprint keeps counts so existing tickets' tags never shift; only in-run merging ignores
 * them.
 */
export function collapseCountVariants(candidates: readonly BugCandidate[]): BugCandidate[] {
  const canonical = new Map<string, string>();
  const remapped = candidates.map((candidate) => {
    if (candidate.source !== 'api' || candidate.systemic) return candidate;
    const key = [
      candidate.product,
      candidate.endpoint ?? '',
      candidate.classification,
      normalizeForFingerprint(candidate.title.replace(/\b\d+\/\d+\b/g, '<n>/<n>')),
    ].join('|');
    const id = canonical.get(key);
    if (!id) {
      canonical.set(key, candidate.id);
      return candidate;
    }
    return { ...candidate, id };
  });
  return mergeCandidates(remapped);
}

/** The aggregate error-response validator — rolls up many error cases for one endpoint into one finding. */
const AGGREGATE_ERROR_VALIDATOR = 'common.api-error';

/**
 * Holds the aggregate `common.api-error` finding for review when the same endpoint also has
 * specific findings this run, since both would file overlapping tickets. Nothing is dropped.
 */
export function holdAggregatesForReview(candidates: readonly BugCandidate[]): BugCandidate[] {
  const endpointsWithSpecifics = new Set(
    candidates
      .filter(
        (c) =>
          c.source === 'api' &&
          !c.systemic &&
          c.classification !== AGGREGATE_ERROR_VALIDATOR &&
          c.endpoint,
      )
      .map((c) => c.endpoint),
  );
  return candidates.map((c) => {
    if (
      c.source === 'api' &&
      !c.systemic &&
      c.classification === AGGREGATE_ERROR_VALIDATOR &&
      c.endpoint &&
      endpointsWithSpecifics.has(c.endpoint) &&
      !c.reviewHold
    ) {
      return {
        ...c,
        reviewHold:
          'an aggregate error-response finding for an endpoint that also has specific per-case ' +
          'findings this run — held so you can decide whether this broader ticket adds value on top ' +
          'of the specific ones (nothing is dropped)',
      };
    }
    return c;
  });
}

/**
 * Collapses candidates that share an identity: one ticket per defect, with the occurrence count
 * and (for UI defects) every browser that observed it.
 */
export function mergeCandidates(candidates: readonly BugCandidate[]): BugCandidate[] {
  const merged = new Map<string, BugCandidate>();
  for (const candidate of candidates) {
    const existing = merged.get(candidate.id);
    if (!existing) {
      merged.set(candidate.id, {
        ...candidate,
        // Clone the list so accumulating onto the merged copy never mutates the source candidate.
        affectedEndpoints: candidate.affectedEndpoints
          ? [...candidate.affectedEndpoints]
          : undefined,
        affectedScope: candidate.affectedScope?.map((s) => ({ ...s })),
      });
      continue;
    }
    existing.occurrences += candidate.occurrences;
    const browsers = new Set([...(existing.browsers ?? []), ...(candidate.browsers ?? [])]);
    if (browsers.size) existing.browsers = [...browsers].sort();
    // Keep every browser's proof (screenshot + video), so the ticket shows the defect in each.
    if (candidate.proof?.length) {
      existing.proof = [...(existing.proof ?? []), ...candidate.proof];
    }
    // A systemic defect's ticket lists every endpoint the same fault was seen on.
    if (candidate.affectedEndpoints?.length) {
      const endpoints = new Set([
        ...(existing.affectedEndpoints ?? []),
        ...candidate.affectedEndpoints,
      ]);
      existing.affectedEndpoints = [...endpoints].sort();
    }
    for (const seen of candidate.affectedScope ?? []) {
      const row = existing.affectedScope?.find((s) => s.endpoint === seen.endpoint);
      if (row) row.count += seen.count;
      else (existing.affectedScope ??= []).push({ ...seen });
    }
    existing.affectedScope?.sort((a, b) => a.endpoint.localeCompare(b.endpoint));
  }
  return [...merged.values()];
}

/**
 * Validators that read the primary response, so on a 5xx or timeout they are symptoms, not defects.
 */
const CASCADE_DEPENDENT = new Set([
  'response.structure',
  'response.schema',
  'response.content-type',
  'response.error-format',
  'response.metadata',
  'response.pagination',
  'response.headers',
  'response.time',
  'common.api-error',
  'common.boolean',
  'common.date',
  'common.email',
  'common.id',
  'common.url',
  'performance.response-time',
  'performance.timeout',
  'performance.payload-size',
]);

const looksLikeTimeout = (c: BugCandidate): boolean =>
  /timeout|timed out|exceeds budget|\bms exceeds\b/i.test(`${c.actual} ${c.title}`);

/**
 * Folds a "not a valid error envelope" structure finding into the error-format finding for the same
 * malformed error body. A bad success envelope is a different defect and is left alone.
 */
function foldEnvelopePair(group: readonly BugCandidate[]): BugCandidate[] {
  const format = group.find((c) => c.classification === 'response.error-format');
  const structure = group.filter(
    (c) =>
      c.classification === 'response.structure' &&
      /not a valid error envelope/i.test(`${c.actual} ${c.title}`),
  );
  if (!format || !structure.length) return [...group];
  const folded: BugCandidate = {
    ...format,
    narrative:
      `${format.narrative}\n\nThe same error response also fails the standard error-envelope check ` +
      `(response.structure). It is the same root cause and is consolidated here rather than filed separately.`,
    ...(format.summary
      ? {
          summary: `${format.summary} The same reply also fails the response-shape check; that is part of this bug.`,
        }
      : {}),
    evidence: { ...format.evidence, envelopeConsolidated: true },
  };
  return [folded, ...group.filter((c) => c !== format && !structure.includes(c))];
}

/**
 * Collapses a per-endpoint cascade: on a 5xx, dependent checks fold into the status-code anchor and
 * independent findings stay; on a timeout everything folds. Systemic candidates are untouched.
 */
export function consolidateCascades(candidates: readonly BugCandidate[]): BugCandidate[] {
  const byEndpoint = new Map<string, BugCandidate[]>();
  const passthrough: BugCandidate[] = [];
  for (const c of candidates) {
    if (c.systemic || !c.endpoint) {
      passthrough.push(c);
      continue;
    }
    const group = byEndpoint.get(c.endpoint) ?? [];
    group.push(c);
    byEndpoint.set(c.endpoint, group);
  }

  const kept: BugCandidate[] = [...passthrough];
  for (const [endpoint, group] of byEndpoint) {
    const timedOut = group.some(looksLikeTimeout);
    const serverError = group.some((c) => (c.responseStatus ?? 0) >= 500);
    if (!timedOut && !serverError) {
      // Endpoint responds fine; these are genuinely distinct findings, except that one malformed
      // error body fails both the error-format and the error-envelope checks.
      kept.push(...foldEnvelopePair(group));
      continue;
    }
    // Pick the anchor: the status-code finding, else the first.
    const anchor =
      group.find((c) => c.classification === 'response.status-code') ??
      group.find((c) => !CASCADE_DEPENDENT.has(c.classification)) ??
      group[0]!;
    // When the valid request itself 5xx'd, an input probe's 5xx is the same root cause.
    const primaryCrashed =
      anchor.classification === 'response.status-code' && (anchor.responseStatus ?? 0) >= 500;
    const sameCrash = (c: BugCandidate): boolean =>
      primaryCrashed &&
      /^(request\.|security\.(injection|xss))/.test(c.classification) &&
      ((c.responseStatus ?? 0) >= 500 || /got 5\d\d|server error/i.test(`${c.actual} ${c.title}`));
    // On a timeout the whole endpoint is down → fold everything. On a 5xx, keep independent findings.
    const independents = timedOut
      ? []
      : group.filter(
          (c) => c !== anchor && !CASCADE_DEPENDENT.has(c.classification) && !sameCrash(c),
        );
    const folded = group.filter((c) => c !== anchor && !independents.includes(c));
    if (folded.length) {
      const names = [...new Set(folded.map((c) => c.classification))].sort();
      const cause = timedOut ? 'times out' : `returns HTTP ${anchor.responseStatus ?? '5xx'}`;
      kept.push({
        ...anchor,
        narrative:
          `${anchor.narrative}\n\nThis endpoint ${cause}, so ${folded.length} dependent check(s) ` +
          `also failed as a consequence of the same root cause and are consolidated here rather than ` +
          `filed separately: ${names.join(', ')}.`,
        ...(anchor.summary
          ? {
              summary:
                `${anchor.summary} Because it ${cause}, ${folded.length} other check(s) on it ` +
                `failed too; they are part of this bug.`,
            }
          : {}),
        evidence: { ...anchor.evidence, cascadeConsolidated: names, endpoint },
      });
    } else {
      kept.push(anchor);
    }
    kept.push(...independents);
  }
  return kept;
}

/**
 * One screen's axe-core results. Findings are filed as one ticket per WCAG rule listing every
 * screen, and only critical/serious violations are fileable.
 */
export interface AccessibilityScreenInput {
  screen: string;
  route: string;
  violations: {
    id: string;
    impact: 'critical' | 'serious' | 'moderate' | 'minor';
    help: string;
    helpUrl: string;
    tags: string[];
    nodeCount: number;
    targets: string[];
  }[];
  /** This screen's screenshot/video from the run. */
  proof?: ProofFile[];
}

const A11Y_SEVERITY: Record<'critical' | 'serious', Severity> = {
  critical: 'CRITICAL',
  serious: 'HIGH',
};

/** The screens' shared component, or the UI fallback when a rule spans several components. */
function componentForScreens(
  suite: ReturnType<typeof suiteFor>,
  screens: readonly string[],
): string {
  const components = new Set(screens.map((name) => componentFor(suite, [name.toLowerCase()])));
  return components.size === 1 ? [...components][0]! : suite.bugzilla.fallbackComponent;
}

export function accessibilityCandidatesFromScreens(
  screens: readonly AccessibilityScreenInput[],
  config: BugzillaConfig,
): BugCandidate[] {
  const suite = suiteFor('kpost-ui');

  // Group by rule id, one entry per screen (repeats across browsers count once).
  const byRule = new Map<
    string,
    { impact: 'critical' | 'serious'; help: string; helpUrl: string; tags: string[] } & {
      screens: Map<string, { nodeCount: number; targets: string[]; proof?: ProofFile[] }>;
    }
  >();
  for (const screen of screens) {
    for (const v of screen.violations) {
      if (v.impact !== 'critical' && v.impact !== 'serious') continue;
      const entry = byRule.get(v.id) ?? {
        impact: v.impact,
        help: v.help,
        helpUrl: v.helpUrl,
        tags: v.tags,
        screens: new Map<string, { nodeCount: number; targets: string[]; proof?: ProofFile[] }>(),
      };
      // The worse impact observed for the rule wins.
      if (v.impact === 'critical') entry.impact = 'critical';
      const existing = entry.screens.get(screen.screen);
      if (!existing || v.nodeCount > existing.nodeCount) {
        entry.screens.set(screen.screen, {
          nodeCount: v.nodeCount,
          targets: v.targets,
          proof: screen.proof,
        });
      }
      byRule.set(v.id, entry);
    }
  }

  const now = new Date().toISOString();
  return [...byRule.entries()].map(([ruleId, rule]) => {
    const screenNames = [...rule.screens.keys()].sort();
    const component = componentForScreens(suite, screenNames);
    const totalNodes = [...rule.screens.values()].reduce((sum, s) => sum + s.nodeCount, 0);
    const exampleTargets = [...rule.screens.values()][0]?.targets ?? [];
    // Every affected screen's proof, deduped by label (a retry can recapture the same screen).
    const seenLabels = new Set<string>();
    const proof = [...rule.screens.values()]
      .flatMap((s) => s.proof ?? [])
      .filter((p) => (seenLabels.has(p.label) ? false : (seenLabels.add(p.label), true)));

    return {
      // Stable per rule, so a re-run comments/reopens instead of duplicating.
      id: systemicFingerprint({
        prefix: config.tagPrefix,
        validatorName: `accessibility.${ruleId}`,
        message: ruleId,
      }),
      source: 'ui',
      suiteId: suite.id,
      title: `WCAG violation — ${ruleId}: ${maskString(rule.help)} (${screenNames.length} screen${screenNames.length > 1 ? 's' : ''})`,
      narrative:
        `axe-core (WCAG 2.1 A/AA) found the same accessibility rule failing on ` +
        `${screenNames.length} screen${screenNames.length > 1 ? 's' : ''} of the ${suite.label}: ` +
        `"${rule.help}". This is ONE shared root cause — most likely one component or pattern reused ` +
        `across those screens — so one fix should resolve it everywhere it appears, filed as a single ` +
        `ticket rather than one per screen. See ${rule.helpUrl} for the rule's full explanation and how ` +
        `to fix it.`,
      summary:
        `The accessibility rule "${rule.help}" fails on ${screenNames.length} ` +
        `screen${screenNames.length > 1 ? 's' : ''} (listed under Actual). People who use a screen ` +
        `reader or only a keyboard cannot use those parts of the app. It most likely comes from one ` +
        `shared component, so one fix should clear it everywhere (rule details: ${rule.helpUrl}).`,
      severity: A11Y_SEVERITY[rule.impact],
      // The tracker filters on its own Accessibility category.
      category: 'Accessibility',
      classification: `accessibility.${ruleId}`,
      product: suite.bugzilla.product,
      component,
      version: suite.bugzilla.version,
      assignee: suite.owner.email,
      ownerName: suite.owner.name,
      expected: `No ${rule.impact} "${ruleId}" violations on any screen.`,
      actual:
        `${rule.help} — found on ${screenNames.length} screen(s), ${totalNodes} element(s) total: ` +
        `${screenNames.join(', ')}.`,
      occurrences: totalNodes,
      environment: config.dryRun ? 'test' : 'production',
      baseURL: suite.baseUrl,
      build: process.env.BUILD_ID ?? 'local',
      testRunId: process.env.TEST_RUN_ID ?? 'run',
      observedAt: now,
      evidence: maskSensitive({
        module: suite.label,
        rule: ruleId,
        impact: rule.impact,
        wcagTags: rule.tags,
        helpUrl: rule.helpUrl,
        exampleSelectors: exampleTargets,
        screens: Object.fromEntries(
          [...rule.screens.entries()].map(([name, s]) => [name, { nodeCount: s.nodeCount }]),
        ),
      }),
      proof,
    };
  });
}
