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
