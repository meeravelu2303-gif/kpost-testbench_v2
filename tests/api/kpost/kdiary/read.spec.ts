import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * WHAT is tested: the KDiary reads — today's schedules, all events, today's report, events by date.
 * HOW is owned by the central validation engine. All run on live (our own diary).
 */
test.describe('KPost KDiary · reads', () => {
  describeEndpointCases({ tags: ['kdiary-read'] });
});
