import { thresholds } from '@config/thresholds.config';
import { defineValidator } from '@engine/validator';
import { fromChecks, outcome } from '@engine/validation-result';
import { getPath } from '@utils/json';
import { hasNoContent } from '../support';

export const metadataValidator = defineValidator({
  name: 'response.metadata',
  category: 'RESPONSE',
  severity: 'LOW',
  description: 'Envelope metadata echoes the correlation ID and carries a current timestamp',
  toggle: 'responseStructure',
  dependsOn: ['response.structure'],
  appliesTo: ({ endpoint, primary }) => {
    if (!endpoint.envelope) return 'endpoint does not use the response envelope';
    return hasNoContent(primary) ? `response has no content (HTTP ${primary.status})` : true;
  },
  check: ({ primary }) => {
    const parsed = primary.json();
    if (!parsed.ok) return outcome.failed(parsed.reason);
    const correlationId = getPath(parsed.value, 'metadata.correlationId');
    const timestamp = getPath(parsed.value, 'metadata.timestamp');
    const skew =
      typeof timestamp === 'string' ? Math.abs(Date.now() - Date.parse(timestamp)) : Number.NaN;
    return fromChecks(
      [
        {
          name: 'metadata.correlationId',
          status: correlationId === primary.correlationId ? 'PASSED' : 'FAILED',
          expected: primary.correlationId,
          actual: correlationId,
        },
        {
          name: 'metadata.timestamp',
          status: skew <= thresholds.clockSkewMs ? 'PASSED' : 'FAILED',
          expected: `within ${thresholds.clockSkewMs}ms of now`,
          actual: timestamp,
        },
      ],
      'metadata checks',
    );
  },
});
