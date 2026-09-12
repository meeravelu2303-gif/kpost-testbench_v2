import { defineValidator } from '@engine/validator';
import { PROFILE_SETS } from '@engine/validation-policy';
import { outcome } from '@engine/validation-result';

export const payloadSizeValidator = defineValidator({
  name: 'performance.payload-size',
  category: 'PERFORMANCE',
  severity: 'LOW',
  description: 'Response body size stays within the configured limit',
  toggle: 'performance',
  profiles: PROFILE_SETS.DEEP,
  check: ({ primary, endpoint }) => {
    const max = endpoint.performance.maxPayloadBytes;
    const extras = { expected: `<= ${max} bytes`, actual: `${primary.sizeBytes} bytes` };
    return primary.sizeBytes <= max
      ? outcome.passed(`${primary.sizeBytes} bytes`, extras)
      : outcome.failed(`${primary.sizeBytes} bytes exceeds ${max}`, extras);
  },
});
