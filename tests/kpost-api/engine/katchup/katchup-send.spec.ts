import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * The Katchup send endpoints, through the validation engine. Sends reach a real inbox, so they are
 * blocked on live (none is productionSafe) and run in full only against the mock.
 */
test.describe('KPost Katchup · sends', { tag: ['@api', '@katchup', '@regression'] }, () => {
  describeEndpointCases({ tags: ['katchup-send'] });
});
