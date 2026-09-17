/**
 * Plain-language guidance embedded in every filed ticket, keyed by the validator that found the
 * defect. The goal: a developer opening the bug in Bugzilla understands **what it is, why it
 * matters, and how to fix it** without asking anyone — so the ticket is self-explanatory.
 *
 * Kept short (a few sentences each) so it informs without burying the evidence. Matched by exact
 * validator name, with a prefix fallback for the auth-token and input-validation families.
 */

export interface Guidance {
  /** What the defect is, in plain terms. */
  meaning: string;
  /** The real-world consequence — why a developer should care. */
  why: string;
  /** The concrete fix. */
  fix: string;
}

const EXACT: Record<string, Guidance> = {
  'security.security-headers': {
    meaning:
      'The API response is missing one or more security headers that tell the browser how to protect the user (the Expected/Actual below lists which are missing).',
    why: 'Without them, attacks like cross-site scripting (XSS), token/URL leakage and HTTPS-downgrade are easier — the app loses a layer of defence. For a messaging/mail app holding private data and login tokens, that matters.',
    fix: 'Add the missing headers globally at the API gateway or a response filter — e.g. Content-Security-Policy, Referrer-Policy, Strict-Transport-Security. One change fixes every endpoint.',
  },
  'response.error-format': {
    meaning:
      'Error responses do not follow the documented envelope ({status, statusCode, message}) — fields are missing or the wrong type.',
    why: 'Clients read the envelope to show the user a meaningful error. An inconsistent shape breaks their error handling and makes failures hard to diagnose.',
    fix: 'Return the standard error envelope on every error response, with the right field types.',
  },
  'response.status-code': {
    meaning:
      'The endpoint returned an HTTP status code that does not match what the operation should return (see Expected vs Actual).',
    why: 'Clients and monitoring rely on the status code: a 500 for a client mistake pages the on-call team for nothing, and a 200 on a failure hides real errors.',
    fix: 'Return the correct status — 2xx for success, 4xx for a client error, and 5xx only for a genuine server fault.',
  },
  'response.structure': {
    meaning: 'The success response does not use the documented { status: "SUCCESS", … } envelope.',
    why: 'Every client expects the same response shape; a different one breaks parsing and forces per-endpoint special cases.',
    fix: 'Wrap the payload in the standard success envelope.',
  },
  'security.sensitive-data': {
    meaning:
      'The response body contains a field that looks sensitive — a password, token, or national-ID number (named in the evidence).',
    why: 'Sensitive data must never be returned in an API response; anyone who can read the response (logs, proxies, the browser) can read the secret.',
    fix: 'Remove the sensitive field from the response payload; return only what the client needs.',
  },
  'response.content-type': {
    meaning: 'The response Content-Type does not match the body the endpoint actually returns.',
    why: 'Clients pick a parser from the Content-Type; a mismatch makes them fail to read a valid body.',
    fix: 'Set the Content-Type to match the body (e.g. application/json for a JSON response).',
  },
  'performance.response-time': {
    meaning: 'The endpoint responded slower than its latency budget (see Expected vs Actual).',
    why: 'Slow responses hurt the user experience and often signal an inefficient query or a missing index.',
    fix: 'Profile the slow path and optimise it — check for N+1 queries, missing indexes, or unbounded result sets.',
  },
  'common.api-error': {
    meaning:
      'An error response returned a 5xx (server error) where a client error (4xx) belongs, or the code inside the body does not match the HTTP status (see Expected vs Actual).',
    why: 'A 5xx pages the on-call team for what is often a client mistake, and a body/HTTP status mismatch breaks the client error handling and monitoring that read the status.',
    fix: 'Return a 4xx for a client error (5xx only for a genuine server fault), and make the status code in the body match the HTTP status.',
  },
  'common.id': {
    meaning:
      'An ID field (`id`, `*Id`) is not in the platform ID format (a positive integer) — the evidence names the field.',
    why: 'Clients, joins and caches key on the ID format; a wrong-typed or malformed ID breaks references and parsing across the app.',
    fix: 'Return IDs in the documented format (a positive integer), consistently on every endpoint.',
  },
  'common.date': {
    meaning:
      'A date field is not an ISO-8601 timestamp with a timezone (or an audit date is in the future / out of order) — see the evidence.',
    why: 'Clients parse and display dates by the ISO-8601 contract; a timezone-less or non-standard date is shown wrong, and a future or unordered audit date signals a data bug.',
    fix: 'Serialize dates as ISO-8601 with an explicit timezone offset, and ensure createdAt ≤ updatedAt with no future audit timestamps.',
  },
  'common.email': {
    meaning: 'An email field contains a value that is not a syntactically valid email address.',
    why: 'Mail is sent to these addresses; an invalid one bounces or fails silently, and a malformed address can indicate corrupted data.',
    fix: 'Validate and store a well-formed address, and return it in valid form.',
  },
  'common.url': {
    meaning:
      'A URL field is not an absolute http(s) URL (it is relative, empty or malformed) — see the evidence.',
    why: 'Clients follow these URLs directly (images, attachments, links); a relative or malformed URL breaks the link for every user.',
    fix: 'Return an absolute http(s) URL.',
  },
  'common.boolean': {
    meaning:
      'A flag field (`is*`, `has*`, `enabled`, …) is a string or number ("true", 1) instead of a real JSON boolean.',
    why: 'Clients test these as booleans, and a string like "false" is truthy in most languages — so the flag reads inverted and the feature behaves backwards.',
    fix: 'Serialize flag fields as JSON booleans (true/false), never strings or numbers.',
  },
};

const AUTH: Guidance = {
  meaning:
    'When a request carries a missing, invalid, malformed or expired auth token, the API correctly rejects it — but with the WRONG HTTP status (400 or 403 instead of 401, see Expected vs Actual).',
  why: 'HTTP 401 is the standard signal for "not authenticated", and clients/gateways rely on it (for example, to trigger a re-login). Returning 400/403 breaks that contract and hides real authentication failures in monitoring.',
  fix: 'In the shared auth filter/gateway, return HTTP 401 for a missing/invalid/malformed/expired token. One change fixes every endpoint.',
};

const INPUT: Guidance = {
  meaning:
    'The endpoint accepted an invalid input (a null, a wrong type, an out-of-range or malformed value) instead of rejecting it.',
  why: 'Accepting bad input lets malformed data into the system, which can corrupt records or cause errors further downstream where they are harder to trace.',
  fix: 'Validate the field and return HTTP 400 with a field error when the input is invalid, rather than processing it.',
};

/** The guidance for a validator, or undefined when there is no specific advice to add. */
export function developerGuidance(classification: string): Guidance | undefined {
  if (EXACT[classification]) return EXACT[classification];
  if (classification.startsWith('authentication.') || classification === 'security.jwt') {
    return AUTH;
  }
  if (classification.startsWith('request.')) return INPUT;
  return undefined;
}
