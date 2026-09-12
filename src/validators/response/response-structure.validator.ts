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
    if (hasNoContent(primary)) return `response has no content (HTTP ${primary.status})`;
    /*
     * An API that documents no error shape cannot have one asserted. Saying so is the honest
     * result; passing would claim a contract we never checked.
     */
    if (primary.isErrorStatus && !endpoint.contract.error)
      return `${endpoint.contract.id} documents no error envelope`;
    return true;
  },
  check: ({ primary, endpoint }) => {
    const parsed = primary.json();
    if (!parsed.ok) return outcome.failed(parsed.reason);
    const { contract } = endpoint;
    const envelope = primary.isErrorStatus ? contract.error : contract.success;
    if (!envelope) return outcome.skipped(`${contract.id} documents no error envelope`);
    const expected = primary.isErrorStatus ? 'error envelope' : 'success envelope';
    const result = envelope.safeParse(parsed.value);
    const issues = result.success
      ? []
      : result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    /*
     * Only demand the payload key where the contract says every success carries one. KPost's
     * envelope has `data` on 67 of 119 documented responses - a message-only reply is valid.
     */
    if (
      !primary.isErrorStatus &&
      contract.dataKey &&
      contract.metadata &&
      !(isPlainObject(parsed.value) && contract.dataKey in parsed.value)
    )
      issues.push(`${contract.dataKey}: missing`);
    return issues.length
      ? outcome.failed(`not a valid ${expected}: ${issues.join('; ')}`, {
          expected,
          actual: issues,
        })
      : outcome.passed(`valid ${expected}`, { expected, actual: expected });
  },
});
