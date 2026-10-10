import { forWriteSweep } from '@api/sweep-target';
import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * WHAT is tested: the Kall writes — direct calls, scheduling, status changes, call-log clearing and
 * the legacy V1 routes. HOW is owned by the central validation engine. Requests are aimed at the
 * throwaway account, so the sweep never rings, schedules with, or clears history against the shared
 * counterparty that the lifecycle flows rely on.
 */
test.describe('KPost Kall · writes', () => {
  describeEndpointCases(
    { tags: ['kall-direct', 'kall-schedule', 'kall-legacy'] },
    { transform: forWriteSweep },
  );
});
