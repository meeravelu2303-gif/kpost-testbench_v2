import { forWriteSweep } from '@api/sweep-target';
import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * WHAT is tested: the KDiary writes — events, schedules, participants, reports, remarks. HOW is
 * owned by the central validation engine. Participants are the throwaway account.
 */
test.describe('KPost KDiary · writes', () => {
  describeEndpointCases({ tags: ['kdiary-write'] }, { transform: forWriteSweep });
});
