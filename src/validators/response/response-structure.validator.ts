import { errorEnvelopeSchema, successEnvelopeSchema } from '@config/api.config';
import { defineValidator } from '@engine/validator';
import { outcome } from '@engine/validation-result';
import { isPlainObject } from '@utils/json';
import { hasNoContent } from '../support';

export const responseStructureValidator = defineValidator({
  name: 'response.structure',
  category: 'RESPONSE',
  severity: 'HIGH',
  description: 'Response follows the standard envelope (success, message, data | errors, metadata)',
  toggle: 'responseStructure',
  appliesTo: ({ endpoint, primary }) => {
    if (!endpoint.envelope) return 'endpoint does not use the response envelope';
    return hasNoContent(primary) ? `response has no content (HTTP ${primary.status})` : true;
  },
  check: ({ primary }) => {
    const parsed = primary.json();
    if (!parsed.ok) return outcome.failed(parsed.reason);
    const envelope = primary.isErrorStatus ? errorEnvelopeSchema : successEnvelopeSchema;
    const expected = primary.isErrorStatus ? 'error envelope' : 'success envelope';
    const result = envelope.safeParse(parsed.value);
    const issues = result.success
      ? []
      : result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    if (!primary.isErrorStatus && !(isPlainObject(parsed.value) && 'data' in parsed.value))
      issues.push('data: missing');
    return issues.length
      ? outcome.failed(`not a valid ${expected}: ${issues.join('; ')}`, {
          expected,
          actual: issues,
        })
      : outcome.passed(`valid ${expected}`, { expected, actual: expected });
  },
});
