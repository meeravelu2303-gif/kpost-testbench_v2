import { apiConfig } from '@config/api.config';
import { PROFILE_SETS } from '@engine/validation-policy';
import { runProbes, type ProbeCase } from '@engine/probe';
import { defineValidator } from '@engine/validator';
import { outcome } from '@engine/validation-result';

/**
 * The error shapes every endpoint must handle, probed centrally.
 *
 * The schema-driven validators already cover *payload* faults — a null, a wrong type, a value out
 * of range. These three cover the faults that have nothing to do with the payload and that every
 * HTTP endpoint is expected to answer correctly:
 *
 *   wrong verb        -> 405 Method Not Allowed
 *   wrong media type  -> 415 Unsupported Media Type
 *   no body at all    -> 400 Bad Request
 *
 * They are worth having centrally because they are exactly the cases hand-written test suites skip:
 * nobody writes "send DELETE to the login endpoint" 70 times, and yet a 200 or a 500 there is a
 * real defect. Written once here, they apply to every endpoint the bench knows about.
 *
 * ## What "correct" means, and why a range is accepted
 *
 * A 405 is the correct answer to a wrong verb, but a gateway that routes by path may legitimately
 * answer 404, and a service that requires auth before routing may answer 401. All three are
 * defensible; **200 and 5xx are not**. So each probe accepts the defensible set and fails on a
 * success or a server fault - the same principle the rest of the bench uses: assert what must be
 * true, not what we would prefer.
 */

/** GET is the only verb that is safe to send at an endpoint that did not ask for it. */
const SAFE_WRONG_METHOD = 'GET' as const;

export const methodNotAllowedValidator = defineValidator({
  name: 'request.method-not-allowed',
  category: 'REQUEST',
  severity: 'MEDIUM',
  description: 'A verb the endpoint does not implement is rejected, never served or 5xx',
  toggle: 'request',
  profiles: PROFILE_SETS.DEEP,
  stage: 'probe',
  appliesTo: ({ endpoint }) =>
    endpoint.method === SAFE_WRONG_METHOD
      ? /*
         * For a GET endpoint the only wrong verbs are mutating ones, and sending POST/PUT/DELETE at
         * a live API to see what happens is how a test suite deletes production data. Skipped with
         * the reason rather than risked.
         */
        'no safe wrong-verb probe exists for a GET endpoint (the alternatives all mutate)'
      : true,
  check: async (context) => {
    const cases: ProbeCase[] = [
      {
        name: `${SAFE_WRONG_METHOD} on a ${context.endpoint.method}-only endpoint`,
        spec: {},
        method: SAFE_WRONG_METHOD,
        expectedStatus: apiConfig.wrongMethodStatus,
      },
    ];
    return runProbes(context, 'request.method-not-allowed', cases, 'wrong-verb cases');
  },
});

export const unsupportedMediaTypeValidator = defineValidator({
  name: 'request.unsupported-media-type',
  category: 'REQUEST',
  severity: 'MEDIUM',
  description: 'A body sent with a media type the endpoint does not accept is rejected',
  toggle: 'request',
  profiles: PROFILE_SETS.DEEP,
  stage: 'probe',
  appliesTo: ({ endpoint, request }) =>
    request.body === undefined
      ? 'endpoint takes no request body'
      : endpoint.contentType !== 'application/json'
        ? `endpoint does not accept JSON (${endpoint.contentType})`
        : true,
  check: async (context) => {
    /*
     * The same valid payload, declared as text/plain. An API that parses it anyway is accepting
     * input it never agreed to accept - the door through which a malformed body reaches a parser
     * that was not written to expect it.
     */
    const cases: ProbeCase[] = [
      {
        name: 'valid JSON body sent as text/plain',
        spec: context.request,
        contentType: 'text/plain',
        expectedStatus: apiConfig.unsupportedMediaTypeStatus,
      },
    ];
    return runProbes(context, 'request.unsupported-media-type', cases, 'media-type cases');
  },
});

export const emptyBodyValidator = defineValidator({
  name: 'request.empty-body',
  category: 'REQUEST',
  severity: 'HIGH',
  description: 'A request with no body at all is rejected where the contract requires one',
  toggle: 'request',
  profiles: PROFILE_SETS.DEEP,
  stage: 'probe',
  appliesTo: ({ endpoint, request }) => {
    if (request.body === undefined) return 'endpoint takes no request body';
    if (!endpoint.requestSchema) return 'endpoint defines no request schema';
    return true;
  },
  check: async (context) => {
    if (!context.endpoint.requestSchema) return outcome.skipped('no request schema');
    /*
     * Two shapes of "nothing": no body, and an empty object. They reach different code paths - a
     * missing body often fails in the framework, `{}` in the handler - and an endpoint that accepts
     * either is an endpoint acting on a request that said nothing.
     */
    const cases: ProbeCase[] = [
      {
        name: 'no request body',
        spec: { ...context.request, body: undefined, rawBody: '' },
        expectedStatus: apiConfig.emptyBodyStatus,
      },
      {
        name: 'empty JSON object',
        spec: { ...context.request, body: {} },
        expectedStatus: apiConfig.emptyBodyStatus,
      },
    ];
    return runProbes(context, 'request.empty-body', cases, 'empty-body cases');
  },
});
