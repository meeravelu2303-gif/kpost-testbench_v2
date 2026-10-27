import { forWriteSweep } from '@api/sweep-target';
import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * The Kall writes (direct, schedule, status, log clearing, legacy V1), through the validation engine.
 * Aimed at the throwaway account so the sweep never touches the counterparty the lifecycle flows use.
 */
test.describe('KPost Kall · writes', { tag: ['@api', '@kall', '@regression'] }, () => {
  describeEndpointCases(
    { tags: ['kall-direct', 'kall-schedule', 'kall-legacy'] },
    { transform: forWriteSweep },
  );
});
