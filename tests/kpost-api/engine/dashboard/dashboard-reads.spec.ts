import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * WHAT is tested: the Dashboard reads — the Home recent-messages panel.
 * HOW is owned by the central validation engine. All run on live (our own messages).
 */
test.describe('KPost Dashboard · reads', { tag: ['@api', '@home', '@regression'] }, () => {
  describeEndpointCases({ tags: ['dashboard-read'] });
});
