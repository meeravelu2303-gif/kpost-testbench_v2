import type { ApiResponseWrapper } from '@api/client/response-wrapper';
import { toJsonSchema } from '@api/schema/contract-schema';
import { thresholds } from '@config/thresholds.config';
import { runProbes, type ProbeCase } from '@engine/probe';
import type { ValidationContext } from '@engine/validation-context';
import { outcome, type ValidationOutcome } from '@engine/validation-result';
import {
  applyCandidate,
  collectFields,
  schemaType,
  sectionSchema,
  type FieldInfo,
  type RequestSection,
} from '../request/request-mutation';
import { findLeaks } from './leak-patterns';

export interface AttackPayload {
  name: string;
  value: unknown;
}

const SECTIONS: readonly RequestSection[] = ['body', 'query', 'path'];

/** String fields to attack: free-text fields first, then constrained ones (format/enum/pattern). */
function targetFields(context: ValidationContext): FieldInfo[] {
  const strings = SECTIONS.flatMap((section) => {
    const schema = sectionSchema(context.endpoint, section);
    return schema
      ? collectFields(toJsonSchema(schema), section).filter(
          (f) => !f.isRoot && schemaType(f.schema) === 'string',
        )
      : [];
  });
  const constrained = (f: FieldInfo): boolean =>
    'format' in f.schema || 'enum' in f.schema || 'pattern' in f.schema;
  return [...strings.filter((f) => !constrained(f)), ...strings.filter(constrained)].slice(
    0,
    thresholds.security.maxInjectionFields,
  );
}

/**
 * Sends each payload into each target field (fresh valid request per case) and fails on 5xx,
 * leaked internals, accepted payloads where rejection is required, or `extraAssert` findings.
 */
export async function runPayloadProbes(
  context: ValidationContext,
  label: string,
  payloads: readonly AttackPayload[],
  extraAssert?: (exchange: ApiResponseWrapper, payload: AttackPayload) => string | undefined,
): Promise<ValidationOutcome> {
  const fields = targetFields(context);
  if (!fields.length) return outcome.skipped('no string fields to attack');
  const mustReject = context.endpoint.security.injectionMustBeRejected ?? false;

  const cases: ProbeCase[] = [];
  for (const field of fields) {
    for (const payload of payloads) {
      const value =
        field.section !== 'body' && typeof payload.value === 'object'
          ? JSON.stringify(payload.value)
          : payload.value;
      cases.push({
        name: `${field.section}.${field.path}: ${payload.name}`,
        spec: applyCandidate(await context.nextRequest(), field, value),
        assert: (exchange) => {
          const leaks = findLeaks(exchange.bodyText);
          if (leaks.length) return `response leaks ${leaks.join(', ')}`;
          if (mustReject && exchange.status < 400)
            return `payload was accepted (HTTP ${exchange.status})`;
          return extraAssert?.(exchange, payload);
        },
      });
    }
  }
  return runProbes(context, label, cases, `${label.split('.').pop() ?? 'payload'} cases`);
}
