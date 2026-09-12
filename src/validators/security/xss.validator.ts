import { PROFILE_SETS } from '@engine/validation-policy';
import { defineValidator } from '@engine/validator';
import { isJsonResponse } from '../support';
import { runPayloadProbes, type AttackPayload } from './payload-probes';

const XSS_PAYLOADS: readonly AttackPayload[] = [
  { name: 'script tag', value: '<script>alert(1)</script>' },
  { name: 'event handler', value: '"><img src=x onerror=alert(1)>' },
  { name: 'javascript URL', value: 'javascript:alert(1)' },
];

/** A JSON API may echo input, but only as JSON with nosniff — never as renderable HTML. */
export const xssValidator = defineValidator({
  name: 'security.xss',
  category: 'SECURITY',
  severity: 'HIGH',
  description: 'XSS payloads are never reflected in a browser-renderable response',
  toggle: 'security',
  profiles: PROFILE_SETS.SECURITY,
  stage: 'probe',
  check: (context) =>
    runPayloadProbes(context, 'security.xss', XSS_PAYLOADS, (exchange, payload) => {
      if (typeof payload.value !== 'string' || !exchange.bodyText.includes(payload.value))
        return undefined;
      if (!isJsonResponse(exchange))
        return `payload reflected with Content-Type ${exchange.contentType ?? '(missing)'}`;
      return exchange.header('x-content-type-options')?.toLowerCase() === 'nosniff'
        ? undefined
        : 'payload reflected without X-Content-Type-Options: nosniff';
    }),
});
