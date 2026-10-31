import { formatIssues, validateSchema } from '@api/schema/contract-schema';
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
    const data = responseData(context);
    return data.ok ? true : data.reason;
  },
  check: (context) => {
    const data = responseData(context);
    if (!data.ok || !context.endpoint.responseSchema) return outcome.skipped('no response payload');
    const issues = validateSchema(context.endpoint.responseSchema, data.value);
    // A schema read from the backend code says where, so the developer can check the method.
    const source = context.endpoint.definition.responseSchemaSource;
    const from = source ? ` (schema from the ${source})` : '';
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
