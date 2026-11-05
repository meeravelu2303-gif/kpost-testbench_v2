import { formatIssues, validateSchema } from '@api/schema/contract-schema';
import { isRawBodyContract, rawBodyVerdict } from '@api/schema/raw-body-contract';
import { defineValidator } from '@engine/validator';
import { outcome } from '@engine/validation-result';
import { hasNoContent, responseData } from '../support';

export const responseSchemaValidator = defineValidator({
  name: 'response.schema',
  category: 'RESPONSE',
  severity: 'CRITICAL',
  description:
    "Response payload conforms to the endpoint's response schema (JSON Schema / OpenAPI)",
  toggle: 'responseSchema',
  // Validating a success schema against an unexpected status or broken envelope is meaningless.
  dependsOn: ['response.status-code', 'response.structure'],
  appliesTo: (context) => {
    if (!context.endpoint.responseSchema) return 'endpoint defines no response schema';
    if (hasNoContent(context.primary))
      return `response has no content (HTTP ${context.primary.status})`;
    // A file or a bare text answer: its contract is the bytes or the text, not a JSON payload.
    if (isRawBodyContract(context.endpoint.responseSchema)) {
      const raw = rawBodyVerdict(context.endpoint.responseSchema, context.primary);
      return raw.applies ? true : raw.reason;
    }
    const data = responseData(context);
    return data.ok ? true : data.reason;
  },
  check: (context) => {
    const source = context.endpoint.definition.responseSchemaSource;
    const from = source ? ` (schema from the ${source})` : '';
    const raw = isRawBodyContract(context.endpoint.responseSchema)
      ? rawBodyVerdict(context.endpoint.responseSchema, context.primary)
      : undefined;
    if (raw?.applies)
      return raw.issues.length
        ? outcome.failed(
            `${raw.what} does not match its contract${from}: ${raw.issues.join('; ')}`,
            {
              expected: 'matches response contract',
              actual: raw.issues,
            },
          )
        : outcome.passed(`${raw.what} matches its contract`, {
            expected: 'matches response contract',
            actual: 'valid',
          });
    const data = responseData(context);
    if (!data.ok || !context.endpoint.responseSchema) return outcome.skipped('no response payload');
    const issues = validateSchema(context.endpoint.responseSchema, data.value);
    // A schema read from the backend code says where, so the developer can check the method.
    return issues.length
      ? outcome.failed(`${issues.length} schema violation(s)${from}: ${formatIssues(issues)}`, {
          expected: 'matches response schema',
          actual: issues,
        })
      : outcome.passed('payload matches response schema', {
          expected: 'matches response schema',
          actual: 'valid',
        });
  },
});
