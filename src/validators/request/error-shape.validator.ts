import { apiConfig } from '@config/api.config';
import { PROFILE_SETS } from '@engine/validation-policy';
import { runProbes, type ProbeCase } from '@engine/probe';
import { defineValidator } from '@engine/validator';
import { outcome } from '@engine/validation-result';

/**
 * Non-payload error shapes every endpoint must handle: wrong verb (405), wrong media type (415), no
 * body (400). Each accepts the defensible set (e.g. 404/401 too) and fails only on a 200 or 5xx.
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
         * For a GET endpoint every wrong verb mutates, so the probe is skipped rather than risked.
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
    // The valid payload declared as text/plain; parsing it anyway accepts input never agreed to.
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
    // No body and `{}` reach different code paths (framework vs handler).
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
