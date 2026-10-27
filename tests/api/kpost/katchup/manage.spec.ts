import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * The Katchup message actions (recall, delete, mark, report, forward), through the validation engine.
 * They need a real message id, so they skip on live with the reason and run in full against the mock.
 */
test.describe('KPost Katchup · manage', { tag: ['@api', '@katchup', '@regression'] }, () => {
  describeEndpointCases({ tags: ['katchup-manage'] });
});
