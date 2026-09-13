import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * WHAT is tested: the Settings reads — personalization and notification settings. HOW is owned by
 * the central validation engine. Both run on live (our own account).
 */
test.describe('KPost Settings · reads', () => {
  describeEndpointCases({ tags: ['settings-read'] });
});
