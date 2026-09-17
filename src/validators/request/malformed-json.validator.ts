import { apiConfig } from '@config/api.config';
import { runProbes } from '@engine/probe';
import { PROFILE_SETS } from '@engine/validation-policy';
import { defineValidator } from '@engine/validator';
import { carriesRequestBody } from './request-mutation';

const MALFORMED_BODIES: Record<string, string> = {
  'truncated JSON': '{"field": ',
  'trailing comma': '{"field": 1,}',
  'single quotes': "{'field': 1}",
};

export const malformedJsonValidator = defineValidator({
  name: 'request.malformed-json',
  category: 'REQUEST',
  severity: 'HIGH',
  description: 'Syntactically invalid JSON bodies are rejected with a client error, never a 5xx',
  toggle: 'request',
  profiles: PROFILE_SETS.DEEP_AND_SECURITY,
  stage: 'probe',
  appliesTo: (context) =>
    !carriesRequestBody(context.endpoint)
      ? 'a GET carries no request body — a malformed body sent with it is ignored, not parsed'
      : context.endpoint.requestSchema
        ? true
        : 'endpoint accepts no request body',
  check: (context) =>
    runProbes(
      context,
      'request.malformed-json',
      Object.entries(MALFORMED_BODIES).map(([name, rawBody]) => ({
        name,
        spec: { ...context.request, body: undefined, rawBody },
        expectedStatus: apiConfig.malformedJsonStatus,
      })),
      'malformed JSON cases',
    ),
});
